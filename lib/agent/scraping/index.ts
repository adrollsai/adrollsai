/**
 * The scraping capability, assembled: definitions → polite fetch → rows → an
 * honest report.
 *
 * This is the only file in `lib/agent/scraping/` that touches the world beyond
 * the four seams it is handed. Everything it wires together already refuses the
 * right things on its own:
 *
 *   robots.ts      a denial is returned before a page request is made
 *   rate-limit.ts  one in-flight per host, token bucket, Retry-After, backoff
 *   fetch.ts       SSRF guard on every hop, honest UA, 429/5xx retries only,
 *                  login/CAPTCHA/401/403 stop the run
 *   cache.ts       the same URL is not read twice inside the window
 *   extract.ts     a missing required field throws, naming the field
 *
 * What is added here is the part the agent actually says out loud: how many
 * pages were read, how many came from cache, what was refused and why, and how
 * many rows came out. `describeScrapeRun()` is the sentence, and it is built from
 * the page results — never from a count typed by hand.
 *
 * Every request that leaves the process is METERED through `lib/agent/spend.ts`
 * (`recordSpend`, service `other`, unit `page`), so a scrape is visible in the
 * same ledger as a model call. It is priced at `SCRAPE_INR_PER_PAGE` (INR, default
 * 0 = recorded as unpriced), because pretending a page fetch costs nothing is a
 * different kind of lie from pretending it costs something.
 */

import { createRobotsGate, DEFAULT_SCRAPE_USER_AGENT, type RobotsFetcher, type RobotsGate } from './robots';
import { HostRateLimiter } from './rate-limit';
import {
  createScrapeFetch,
  politeFetch,
  scrapeUserAgent,
  type HostResolver,
  type ScrapeFetch,
  type ScrapeMeterEvent,
  type ScrapePageResult,
} from './fetch';
import { defaultScrapeCache, type ScrapeCache } from './cache';
import {
  defaultDefinitionStore,
  definitionUrls,
  definitionVersion,
  extractRows,
  ExtractionError,
  type DefinitionStore,
  type ScrapeDefinition,
  type ScrapeRow,
} from './extract';

export * from './robots';
export * from './rate-limit';
export * from './cache';
export * from './extract';
export { politeFetch, createScrapeFetch, scrapeUserAgent, assertFetchableUrl, classifyBody, ScrapeRefusedError } from './fetch';
export type {
  RefusalKind,
  ScrapeClassification,
  ScrapeFetch,
  ScrapeFetchDeps,
  ScrapeMeterEvent,
  ScrapePageResult,
  ScrapeRequest,
  HostResolver,
} from './fetch';

/** A row as the runner returns it: the extracted fields, plus where it came from. */
export type SourcedRow = ScrapeRow & { _source: string };

export interface ScrapePageSummary {
  url: string;
  finalUrl: string;
  host: string;
  status: number | null;
  classification: ScrapePageResult['classification'];
  ok: boolean;
  cached: boolean;
  attempts: number;
  /** Sum of rate-limit + backoff waits spent on this page, in ms. */
  waitedMs: number;
  delaysMs: number[];
  robotsReason: string | null;
  /** `null` when the page produced rows; otherwise why it did not. */
  refusal: { kind: string; reason: string } | null;
  rows: number;
  notes: string[];
}

export interface ScrapeRunReport {
  definition: string;
  version: string;
  /** Every page in the run, in order. */
  pages: ScrapePageSummary[];
  rows: SourcedRow[];
  /** Pages that returned a body and were parsed. */
  read: number;
  /** …of which this many were served from the cache (no request). */
  cached: number;
  /** Pages actually requested from a host. */
  fetched: number;
  /** Pages refused (robots, SSRF, login, CAPTCHA, 401/403, redirect). */
  refused: number;
  /** Pages that returned rows. */
  succeeded: number;
  /** Duplicate URLs skipped inside this run. */
  duplicates: number;
  ok: boolean;
  /** One sentence, built from the page results. */
  sentence: string;
  /** Set when nothing at all could be produced. */
  error: string | null;
  startedAt: number;
  finishedAt: number;
}

export interface ScrapeRunOptions {
  /** A definition, or the name of a stored one (then `store` is used). */
  definition?: unknown;
  definitionName?: string;
  store?: DefinitionStore;
  inputs?: Record<string, string | string[]>;
  /** Explicit pages, when the caller knows them (still deduped and cached). */
  urls?: string[];
  cache?: ScrapeCache;
  robots?: RobotsGate;
  limiter?: HostRateLimiter;
  fetch?: ScrapeFetch;
  /** DNS seam for the SSRF guard; `null` skips resolution (tests). */
  resolveHost?: HostResolver | null;
  userAgent?: string;
  contactUrl?: string;
  contactEmail?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  cacheTtlMs?: number;
  meter?: (event: ScrapeMeterEvent) => void | Promise<void>;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

/**
 * Records every outbound scrape request in the spend ledger.
 *
 * Deliberately coarse — one `usage_events` row per page read, unit `page` — and
 * deliberately honest: with no configured rate the row is written with
 * `priced: false` and cost 0, which is a countable gap rather than an invisible
 * one. `recordSpend` never throws.
 */
export async function recordScrapeSpend(event: ScrapeMeterEvent): Promise<void> {
  const rate = Number(process.env.SCRAPE_INR_PER_PAGE || 0);
  const priced = Number.isFinite(rate) && rate > 0;
  const { recordSpend } = await import('../spend');
  await recordSpend({
    service: 'other',
    costInr: priced ? rate * Math.max(1, event.units) : 0,
    detail: event.detail,
    units: event.units,
    unit: event.unit,
    priced,
    meta: { host: event.host, status: event.status, cached: event.cached, kind: 'scrape' },
  });
}

/** The default wires: real fetch, real DNS, R2 when configured, metered. */
export function createScrapeRuntime(options: {
  robotsFetcher?: RobotsFetcher;
  userAgent?: string;
  contactUrl?: string;
  contactEmail?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  requestsPerSecond?: number;
  burst?: number;
  cache?: ScrapeCache;
  cacheTtlMs?: number;
  maxAttempts?: number;
  log?: (event: string, data?: Record<string, unknown>) => void;
  meter?: (event: ScrapeMeterEvent) => void | Promise<void>;
} = {}) {
  const log = options.log ?? (() => {});
  const envUserAgent = (process.env.SCRAPE_USER_AGENT || '').trim();
  const envContactUrl = (process.env.SCRAPE_CONTACT_URL || '').trim();
  const contactUrl = options.contactUrl ?? (envContactUrl || undefined);
  const userAgent =
    options.userAgent ??
    (envUserAgent ||
      scrapeUserAgent({
        ...(contactUrl ? { contactUrl } : {}),
      }));
  const meter = options.meter ?? recordScrapeSpend;

  // robots.txt requests are metered too: they are requests to someone's server.
  const robotsFetcher: RobotsFetcher =
    options.robotsFetcher ??
    (async (url, agent) => {
      const response = await createScrapeFetch()(url, {
        method: 'GET',
        headers: { 'User-Agent': agent, Accept: 'text/plain,*/*;q=0.5' },
        redirect: 'follow',
      });
      await safeMeter(meter, {
        service: 'other',
        detail: `robots.txt: ${url} → HTTP ${response.status}`,
        units: 1,
        unit: 'robots.txt',
        host: hostOrEmpty(url),
        status: response.status,
        cached: false,
      });
      return { status: response.status, text: await response.text() };
    });

  const robots = createRobotsGate({
    fetchRobots: robotsFetcher,
    userAgent,
    ...(options.now ? { now: options.now } : {}),
  });

  const limiter = new HostRateLimiter({
    ...(options.requestsPerSecond !== undefined ? { requestsPerSecond: options.requestsPerSecond } : {}),
    ...(options.burst !== undefined ? { burst: options.burst } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.random ? { random: options.random } : {}),
  });

  return {
    robots,
    limiter,
    cache: options.cache ?? defaultScrapeCache(log),
    fetchImpl: createScrapeFetch(),
    userAgent,
    meter,
    log,
    ...(options.contactEmail ? { contactEmail: options.contactEmail } : {}),
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    ...(options.cacheTtlMs !== undefined ? { cacheTtlMs: options.cacheTtlMs } : {}),
  };
}

function hostOrEmpty(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

async function safeMeter(meter: (event: ScrapeMeterEvent) => void | Promise<void>, event: ScrapeMeterEvent) {
  try {
    await meter(event);
  } catch {
    /* metering must never break a scrape */
  }
}

/**
 * Read every page a definition names, extract rows, and report what happened.
 *
 * Never throws for a refused or failed page: those are results. It DOES throw
 * for a bad definition, a missing input or a store error — those are caller bugs
 * and there is nothing to report about.
 */
export async function runScrape(options: ScrapeRunOptions): Promise<ScrapeRunReport> {
  const startedAt = (options.now ?? Date.now)();
  const log = options.log ?? (() => {});

  const definition = await resolveDefinition(options);
  const version = definitionVersion(definition);

  const cache = options.cache ?? defaultScrapeCache(log);
  const runtime = createScrapeRuntime({
    ...(options.contactUrl ? { contactUrl: options.contactUrl } : {}),
    ...(options.contactEmail ? { contactEmail: options.contactEmail } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.random ? { random: options.random } : {}),
    cache,
    ...(options.cacheTtlMs !== undefined ? { cacheTtlMs: options.cacheTtlMs } : {}),
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    ...(options.meter ? { meter: options.meter } : {}),
    log,
  });

  const robots = options.robots ?? runtime.robots;
  const limiter = options.limiter ?? runtime.limiter;
  const fetchImpl = options.fetch ?? runtime.fetchImpl;
  const meter = options.meter ?? runtime.meter;
  const userAgent = options.userAgent ?? runtime.userAgent;

  const requested = [
    ...(options.urls ?? []),
    ...definitionUrls(definition, options.inputs ?? {}),
  ];

  const maxPages = definition.policy?.maxPages ?? 25;
  const unique = [...new Set(requested)];
  if (unique.length > maxPages) {
    throw new ExtractionError({
      definition: definition.name,
      field: 'policy.maxPages',
      detail: `${unique.length} pages requested, but the definition allows ${maxPages} (policy.maxPages)`,
    });
  }
  const duplicates = requested.length - unique.length;

  const pages: ScrapePageSummary[] = [];
  const rows: SourcedRow[] = [];
  const failures: string[] = [];

  for (const url of unique) {
    const result = await politeFetch(
      {
        url,
        definition: definition.name,
        definitionVersion: version,
        ...(options.cacheTtlMs !== undefined ? { cacheTtlMs: options.cacheTtlMs } : {}),
      },
      {
        fetch: fetchImpl,
        robots,
        limiter,
        cache,
        userAgent,
        ...(options.contactUrl ? { contactUrl: options.contactUrl } : {}),
        ...(options.contactEmail ? { contactEmail: options.contactEmail } : {}),
        ...(options.resolveHost !== undefined ? { resolveHost: options.resolveHost } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.sleep ? { sleep: options.sleep } : {}),
        ...(options.random ? { random: options.random } : {}),
        ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
        ...(options.cacheTtlMs !== undefined ? { cacheTtlMs: options.cacheTtlMs } : {}),
        meter,
        log,
      },
    );

    const summary: ScrapePageSummary = {
      url,
      finalUrl: result.finalUrl,
      host: result.host,
      status: result.status,
      classification: result.classification,
      ok: false,
      cached: result.cached,
      attempts: result.attempts,
      waitedMs: result.waitedMs,
      delaysMs: result.delays.map((delay) => delay.delayMs),
      robotsReason: result.robots?.reason ?? null,
      refusal: result.refusal ? { kind: result.refusal.kind, reason: result.refusal.reason } : null,
      rows: 0,
      notes: result.notes,
    };

    if (!result.ok || result.body === null) {
      if (result.refusal) failures.push(`${url}: ${result.refusal.kind} — ${result.refusal.reason}`);
      else failures.push(`${url}: ${result.classification}${result.status ? ` (HTTP ${result.status})` : ''}`);
      pages.push(summary);
      continue;
    }

    try {
      const extracted = extractRows(definition, result.body, { url: result.finalUrl });
      for (const row of extracted) rows.push({ ...row, _source: result.finalUrl });
      summary.rows = extracted.length;
      summary.ok = true;
    } catch (err: any) {
      summary.refusal = {
        kind: 'extraction',
        reason: err instanceof ExtractionError ? err.message : String(err?.message ?? err),
      };
      failures.push(`${url}: extraction failed — ${err?.message ?? String(err)}`);
    }

    pages.push(summary);
  }

  const finishedAt = (options.now ?? Date.now)();
  const read = pages.filter((page) => page.classification === 'ok' && page.refusal?.kind !== 'extraction').length;
  const cached = pages.filter((page) => page.cached).length;
  const fetched = pages.filter((page) => !page.cached && page.attempts > 0 && page.classification !== 'refused').length;
  const refused = pages.filter((page) => page.classification === 'refused').length;
  const succeeded = pages.filter((page) => page.ok && page.rows > 0).length;
  const ok = succeeded > 0 && rows.length > 0;

  const report: ScrapeRunReport = {
    definition: definition.name,
    version,
    pages,
    rows,
    read,
    cached,
    fetched,
    refused,
    succeeded,
    duplicates,
    ok,
    sentence: '',
    error: ok ? null : failures.length ? failures.join('; ') : 'the definition produced no rows',
    startedAt,
    finishedAt,
  };
  report.sentence = describeScrapeRun(report);

  log('scrape.run', {
    definition: definition.name,
    version,
    pages: pages.length,
    read,
    cached,
    fetched,
    refused,
    rows: rows.length,
    sentence: report.sentence,
  });

  return report;
}

/**
 * The sentence the agent relays.
 *
 * Built only from page results, so it cannot drift from what happened:
 * "I read 3 pages (2 from cache) and extracted 61 rows. 1 page was refused:
 * httpbin.org/deny — robots.txt disallows /deny."
 */
export function describeScrapeRun(report: ScrapeRunReport): string {
  const pages = report.pages.length;
  if (!pages) return 'I read no pages: the definition named none.';

  const parts: string[] = [];
  const cachedPart = report.cached ? ` (${report.cached} from cache)` : '';
  parts.push(`I read ${report.read} page${report.read === 1 ? '' : 's'}${cachedPart} and extracted ${report.rows.length} row${report.rows.length === 1 ? '' : 's'}.`);

  if (report.duplicates > 0) {
    parts.push(`${report.duplicates} duplicate URL${report.duplicates === 1 ? ' was' : 's were'} skipped inside the cache window.`);
  }

  const refused = report.pages.filter((page) => page.classification === 'refused' || page.refusal);
  if (refused.length) {
    const detail = refused
      .slice(0, 3)
      .map((page) => `${page.host}${pathOf(page.url)} — ${page.refusal?.kind ?? page.classification}: ${page.refusal?.reason ?? 'refused'}`)
      .join('; ');
    const more = refused.length > 3 ? ` (+${refused.length - 3} more)` : '';
    parts.push(`${refused.length} page${refused.length === 1 ? ' was' : 's were'} refused: ${detail}${more}`);
  }

  const waited = report.pages.reduce((sum, page) => sum + page.waitedMs, 0);
  if (waited > 0) {
    parts.push(`Rate limits held me back for ${Math.round(waited)} ms in total.`);
  }

  return parts.join(' ');
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return '';
  }
}

async function resolveDefinition(options: ScrapeRunOptions): Promise<ScrapeDefinition> {
  if (options.definition) {
    const { parseDefinition } = await import('./extract');
    return parseDefinition(options.definition, options.definitionName ?? 'definition');
  }
  if (!options.definitionName) {
    throw new ExtractionError({
      definition: 'run',
      field: 'definition',
      detail: 'runScrape needs a definition object or the name of a stored definition',
    });
  }
  const store = options.store ?? defaultDefinitionStore();
  const stored = await store.get(options.definitionName);
  if (!stored) {
    const available = (await store.list()).map((entry) => entry.name);
    throw new ExtractionError({
      definition: options.definitionName,
      field: 'definition',
      detail:
        `no stored definition named "${options.definitionName}"` +
        (available.length ? `; stored: ${available.join(', ')}` : '; the store is empty'),
    });
  }
  return stored.definition;
}
