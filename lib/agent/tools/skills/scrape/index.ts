/**
 * The `scrape` skill: a stored definition + inputs → structured rows, and a
 * report of exactly what was read.
 *
 * WHAT THIS FILE IS
 *   The agent-facing surface of `lib/agent/scraping/`. It is thin on purpose:
 *   every rule that matters (robots, rate limits, SSRF, cache, login walls) is
 *   enforced in the library, so a tool call cannot opt out of it. This file adds
 *   three things only:
 *
 *     scrape_definitions        what can be re-run, and each one's fingerprint
 *     scrape_save_definition    persist a named definition (validated before save)
 *     scrape_run                name + inputs → rows + the sentence to relay
 *
 * WHY THE DEFINITION IS A PARAMETER AND NOT PROSE
 *   A definition that exists only in a conversation cannot be re-run, diffed, or
 *   cached honestly. Saving one gives it a version (`definitionVersion`), and
 *   that version is part of the cache key — so the second run of the same
 *   definition serves the same page from R2 instead of asking the site again.
 *
 * WHAT IT WILL NOT DO
 *   Log in. Solve a CAPTCHA. Work around a 403. Fetch a private address. Retry a
 *   refusal. Those are refusals in the library, and the tool surfaces them as a
 *   result with `success: false` and the reason the host gave, because a refusal
 *   the user can see is a valid answer while a silent workaround is not.
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  defaultDefinitionStore,
  definitionVersion,
  describeScrapeRun,
  parseDefinition,
  runScrape,
  type DefinitionStore,
  type HostRateLimiter,
  type HostResolver,
  type RobotsGate,
  type ScrapeCache,
  type ScrapeFetch,
  type ScrapeMeterEvent,
  type ScrapeRunReport,
} from '../../../scraping';

/** Every seam the skill accepts, so the verification can run it offline. */
export interface ScrapeSkillDeps {
  store?: DefinitionStore;
  cache?: ScrapeCache;
  robots?: RobotsGate;
  limiter?: HostRateLimiter;
  fetch?: ScrapeFetch;
  /** DNS for the SSRF guard; `null` skips resolution (tests only). */
  resolveHost?: HostResolver | null;
  meter?: (event: ScrapeMeterEvent) => void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  cacheTtlMs?: number;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

/** The page-by-page record the agent can relay and an operator can audit. */
export interface ScrapeToolRecord {
  url: string;
  host: string;
  status: number | null;
  cached: boolean;
  attempts: number;
  rows: number;
  waitedMs: number;
  robots: string | null;
  refusal: { kind: string; reason: string } | null;
}

function recordOf(report: ScrapeRunReport): ScrapeToolRecord[] {
  return report.pages.map((page) => ({
    url: page.finalUrl || page.url,
    host: page.host,
    status: page.status,
    cached: page.cached,
    attempts: page.attempts,
    rows: page.rows,
    waitedMs: page.waitedMs,
    robots: page.robotsReason,
    refusal: page.refusal,
  }));
}

/**
 * Build the scrape tools.
 *
 * `supabase`/`userId` select the Supabase definition store; without them the
 * file store under `.nobogent/scraping/definitions/` is used, which is what the
 * scripts and a single-tenant deployment want.
 */
export function createScrapeTools(supabase?: unknown, userId?: string, deps: ScrapeSkillDeps = {}) {
  const store = deps.store ?? defaultDefinitionStore({ supabase, userId });

  return {
    scrape_definitions: tool({
      description:
        'List the stored scrape definitions: the named, versioned extraction schemas this account can re-run. ' +
        'Call this before scraping anything — if a definition already exists for the page, run it instead of ' +
        'inventing selectors, and a changed version shows what changed.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const stored = await store.list();
          return {
            success: true,
            count: stored.length,
            definitions: stored.map((entry) => ({
              name: entry.name,
              version: entry.version,
              format: entry.definition.format,
              description: entry.definition.description ?? '',
              fields: entry.definition.fields.map((field) => field.name),
              urlTemplate: entry.definition.urlTemplate ?? (entry.definition.urls ?? []).join(', '),
              inputs: entry.definition.inputs ?? [],
              updatedAt: entry.updatedAt,
            })),
            message: stored.length
              ? 'Run one with scrape_run(name, inputs).'
              : 'No definitions stored yet. Save one with scrape_save_definition before scraping.',
          };
        } catch (err: any) {
          return { success: false, error: err?.message ?? String(err) };
        }
      },
    }),

    scrape_save_definition: tool({
      description:
        'Save (or update) a named scrape definition: which pages to read, which repeated element is a row, and ' +
        'which fields to pull from each row. Validated before it is stored, so a definition that cannot work is ' +
        'rejected with the exact field at fault. Saving the same body again is a no-op (same version); changing ' +
        'a selector produces a new version, which is what makes two runs diffable.',
      inputSchema: z.object({
        definition: z
          .string()
          .describe(
            'The definition as JSON: { name, format: "html"|"json", urlTemplate?: string, urls?: string[], ' +
              'inputs?: string[], rows: { selector?: string, path?: string, limit?: number }, ' +
              'fields: [{ name, optional?, selector?, path?, attribute?, resolve?, number? }] }',
          ),
      }),
      execute: async ({ definition }) => {
        try {
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(definition);
          } catch (err: any) {
            return { success: false, error: `definition is not valid JSON: ${err?.message ?? String(err)}` };
          }
          const validated = parseDefinition(parsedJson);
          const stored = await store.save(validated);
          return {
            success: true,
            name: stored.name,
            version: stored.version,
            fields: validated.fields.map((field) => field.name),
            rows: validated.rows,
            message:
              `Saved "${stored.name}" at version ${stored.version}. ` +
              'scrape_run can be called with this name; the version is also the cache key, so re-running it ' +
              'inside the cache window does not touch the site.',
          };
        } catch (err: any) {
          return { success: false, error: err?.message ?? String(err) };
        }
      },
    }),

    scrape_run: tool({
      description:
        'Run a stored scrape definition and return structured rows. Obeys robots.txt and per-host rate limits, ' +
        'caches the page in R2, and stops dead on a login wall, a CAPTCHA, a 401/403 or a private address — ' +
        'reporting the refusal rather than working around it. Returns the rows plus a report of every page ' +
        '(host, HTTP status, cached or not, attempts, rows) so you can say exactly what was read.',
      inputSchema: z.object({
        name: z.string().describe('The stored definition name, from scrape_definitions'),
        inputs: z
          .record(z.string(), z.union([z.string(), z.array(z.string())]))
          .optional()
          .describe('Values for the definition\'s declared inputs; an array fans out to one page per value'),
        urls: z
          .array(z.string())
          .max(25)
          .optional()
          .describe('Extra or alternative pages for this run (max 25; robots still applies to each)'),
        purpose: z.string().optional().describe('Why this is being scraped, for the audit log'),
      }),
      execute: async ({ name, inputs, urls, purpose }) => {
        try {
          const report = await runScrape({
            definitionName: name,
            store,
            ...(inputs ? { inputs } : {}),
            ...(urls?.length ? { urls } : {}),
            ...(deps.cache ? { cache: deps.cache } : {}),
            ...(deps.robots ? { robots: deps.robots } : {}),
            ...(deps.limiter ? { limiter: deps.limiter } : {}),
            ...(deps.fetch ? { fetch: deps.fetch } : {}),
            ...(deps.resolveHost !== undefined ? { resolveHost: deps.resolveHost } : {}),
            ...(deps.meter ? { meter: deps.meter } : {}),
            ...(deps.now ? { now: deps.now } : {}),
            ...(deps.sleep ? { sleep: deps.sleep } : {}),
            ...(deps.random ? { random: deps.random } : {}),
            ...(deps.maxAttempts !== undefined ? { maxAttempts: deps.maxAttempts } : {}),
            ...(deps.cacheTtlMs !== undefined ? { cacheTtlMs: deps.cacheTtlMs } : {}),
            ...(deps.log ? { log: deps.log } : {}),
          });

          const record = recordOf(report);
          if (deps.log) {
            deps.log('scrape.skill.ran', {
              definition: report.definition,
              version: report.version,
              purpose: purpose ?? null,
              pages: record,
              rows: report.rows.length,
            });
          }

          if (!report.ok) {
            return {
              success: false,
              definition: report.definition,
              version: report.version,
              error: report.error ?? 'the run produced no rows',
              report: {
                read: report.read,
                cached: report.cached,
                refused: report.refused,
                duplicates: report.duplicates,
                pages: record,
                sentence: report.sentence,
              },
              message:
                `${report.sentence} Nothing was worked around: a refusal is final, so tell the user what was ` +
                'refused and why rather than retrying differently.',
            };
          }

          return {
            success: true,
            definition: report.definition,
            version: report.version,
            count: report.rows.length,
            rows: report.rows,
            report: {
              read: report.read,
              cached: report.cached,
              fetched: report.fetched,
              refused: report.refused,
              duplicates: report.duplicates,
              pages: record,
              sentence: report.sentence,
              startedAt: report.startedAt,
              finishedAt: report.finishedAt,
            },
            message: report.sentence,
          };
        } catch (err: any) {
          return { success: false, error: err?.message ?? String(err) };
        }
      },
    }),
  };
}

/** The fingerprint of a definition without running it — used by the audit script. */
export function versionOf(body: unknown): string {
  return definitionVersion(parseDefinition(body));
}

export { describeScrapeRun };
