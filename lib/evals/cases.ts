/* eslint-disable @typescript-eslint/no-explicit-any --
 * Raw JSON case entries are deliberately untyped until zod has parsed them — validating unknown input is the entire purpose of this module.
 */
/**
 * Loads and validates the eval case set.
 *
 * Cases live as JSON in `evals/cases/` rather than inline in a TypeScript file so
 * that adding one is an edit a non-engineer can make — and so that the corpus can
 * grow from real customer corrections (see scripts/evals-from-feedback.ts) without
 * touching code. That is the difference between a test suite and an asset.
 *
 * Everything is validated here, once: unknown series, duplicate ids, a regex that
 * does not compile, or a case that asserts nothing all fail at LOAD time with the
 * case named. A silently non-matching regex would otherwise look like a passing
 * guardrail, which is the worst possible failure mode for a safety suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { EVAL_SERIES, type EvalCaseFile, type EvalSeries, type EvalTier } from './types';
import { compilePattern } from './metrics';

const SERIES_TUPLE = [...EVAL_SERIES] as [EvalSeries, ...EvalSeries[]];

/** Stable kebab id — it keys the trend, so it must be URL- and SQL-safe. */
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const caseSchema = z
  .object({
    id: z.string().regex(ID_RE, 'id must be kebab-case: lowercase letters, digits and single hyphens'),
    title: z.string().min(3),
    series: z.enum(SERIES_TUPLE),
    severity: z.enum(['critical', 'high', 'normal']),
    tier: z.enum(['context', 'behaviour']),
    prompt: z.string().min(1),
    notes: z.string().optional(),

    mustExpose: z.array(z.string()).optional(),
    mustNotExpose: z.array(z.string()).optional(),
    promptMust: z.array(z.string()).optional(),
    promptMustNot: z.array(z.string()).optional(),

    expectAnyTool: z.array(z.string()).optional(),
    forbidTools: z.array(z.string()).optional(),
    replyMust: z.array(z.string()).optional(),
    replyMustNot: z.array(z.string()).optional(),
    maxSteps: z.number().int().positive().optional(),
    maxCostInr: z.number().nonnegative().optional(),
    expectApprovalPath: z.boolean().optional(),
    judge: z.boolean().optional(),
    repeat: z.number().int().positive().max(10).optional(),
  })
  // A typo'd field is a case that silently asserts nothing. Refuse it rather than
  // discover months later that half the suite was decorative.
  .strict();

export interface LoadedSuite {
  version: string;
  hash: string;
  cases: EvalCaseFile[];
  /** Non-fatal notices (e.g. a series with no coverage). */
  warnings: string[];
}

export interface LoadOptions {
  /** Directory holding the case JSON files. Defaults to <repo>/evals/cases. */
  dir?: string;
  /** Only these ids. */
  only?: string[];
  /** Only these tiers. */
  tiers?: EvalTier[];
  /** Only these series. */
  series?: EvalSeries[];
}

/**
 * Locate the repo root.
 *
 * Prefers the current working directory (every npm script runs from the repo
 * root) and falls back to walking up from this module, so the loader works both
 * from a bundler output at the root and from `ts-node`-style execution.
 */
export function findRepoRoot(): string {
  const candidates: string[] = [];
  if (process.env.EVAL_DIR) return process.env.EVAL_DIR;
  candidates.push(process.cwd());
  try {
    // import.meta.url survives the esbuild ESM output the npm scripts produce.
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    candidates.push(here, path.resolve(here, '..'));
  } catch {
    /* not ESM — cwd is enough */
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'evals', 'cases'))) return c;
  }
  return process.cwd();
}

/** Canonical JSON: keys sorted recursively, so the hash is stable across rewrites. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Fingerprint of the case set.
 *
 * Two runs may only be compared when this matches: a 40-case suite measured 90%
 * and a 47-case suite measured 88% are not the same measurement, and presenting
 * them as a trend line would be a lie.
 */
export function suiteHashFor(cases: EvalCaseFile[]): string {
  const canonical = [...cases]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => canonicalJson(c));
  return crypto.createHash('sha256').update(canonical.join('\n')).digest('hex');
}

function readSuiteVersion(root: string): string {
  const manifest = path.join(root, 'evals', 'suite.json');
  try {
    const raw = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (typeof raw?.version === 'string' && raw.version.trim()) return raw.version.trim();
  } catch {
    /* fall through */
  }
  return process.env.EVAL_SUITE_VERSION?.trim() || '1.0.0';
}

/**
 * Load every `*.json` in the cases directory.
 *
 * `drafts/` is skipped: that is where scripts/evals-from-feedback.ts proposes new
 * cases from real customer corrections. A proposed case has not been reviewed,
 * graded or given a correct answer, so it must never silently join the scored
 * suite — a draft that asserted the wrong thing would manufacture regressions.
 */
export function loadSuite(options: LoadOptions = {}): LoadedSuite {
  const root = findRepoRoot();
  const dir = options.dir ?? path.join(root, 'evals', 'cases');

  if (!fs.existsSync(dir)) {
    throw new Error(`no eval cases at ${dir}`);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (!files.length) throw new Error(`no *.json case files in ${dir}`);

  const cases: EvalCaseFile[] = [];
  const seen = new Map<string, string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const full = path.join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err: any) {
      errors.push(`${file}: not valid JSON — ${err?.message || err}`);
      continue;
    }

    // A case file may hold a single case or an array of them.
    const entries = Array.isArray(raw) ? raw : [raw];

    for (const entry of entries) {
      const parsed = caseSchema.safeParse(entry);
      if (!parsed.success) {
        const id = (entry as any)?.id ?? '(no id)';
        const detail = parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ');
        errors.push(`${file} [${id}]: ${detail}`);
        continue;
      }

      const c = parsed.data as EvalCaseFile;

      const prior = seen.get(c.id);
      if (prior) {
        errors.push(`duplicate case id "${c.id}" in ${file} and ${prior}`);
        continue;
      }
      seen.set(c.id, file);

      // ── a case must actually assert something ──────────────────────────────
      const assertions =
        c.tier === 'context'
          ? [c.mustExpose, c.mustNotExpose, c.promptMust, c.promptMustNot].some((x) => x?.length)
          : [
              c.expectAnyTool,
              c.forbidTools,
              c.replyMust,
              c.replyMustNot,
              c.expectApprovalPath ? [1] : undefined,
              typeof c.maxSteps === 'number' ? [1] : undefined,
              typeof c.maxCostInr === 'number' ? [1] : undefined,
            ].some((x) => x?.length);

      if (!assertions) {
        errors.push(`${file} [${c.id}]: a ${c.tier} case must assert something or it can only ever pass vacuously`);
        continue;
      }

      // ── every regex must compile, now ─────────────────────────────────────
      const patterns = [
        ...(c.promptMust ?? []),
        ...(c.promptMustNot ?? []),
        ...(c.replyMust ?? []),
        ...(c.replyMustNot ?? []),
      ];
      let bad = false;
      for (const p of patterns) {
        try {
          compilePattern(p);
        } catch (err: any) {
          errors.push(`${file} [${c.id}]: ${err?.message || err}`);
          bad = true;
        }
      }
      if (bad) continue;

      // ── context fields on a behaviour case are dead weight ────────────────
      if (c.tier === 'behaviour' && (c.mustExpose?.length || c.promptMust?.length)) {
        warnings.push(
          `${c.id}: context-only fields (mustExpose/promptMust) are ignored on a behaviour case — put them in a context case`
        );
      }
      if (c.tier === 'context' && (c.expectAnyTool?.length || c.replyMust?.length)) {
        warnings.push(
          `${c.id}: behaviour-only fields are ignored on a context case — nothing calls a model`
        );
      }
      if (c.tier === 'behaviour' && c.severity === 'critical' && !c.forbidTools?.length && !c.replyMustNot?.length) {
        warnings.push(
          `${c.id}: marked critical but asserts no forbidden behaviour — critical is reserved for money/customer/data safety`
        );
      }

      cases.push(c);
    }
  }

  if (errors.length) {
    throw new Error(`invalid eval cases (${errors.length}):\n  - ${errors.join('\n  - ')}`);
  }

  // ── filters ───────────────────────────────────────────────────────────────
  let selected = cases;
  if (options.tiers?.length) selected = selected.filter((c) => options.tiers!.includes(c.tier));
  if (options.series?.length) selected = selected.filter((c) => options.series!.includes(c.series));
  if (options.only?.length) {
    const wanted = new Set(options.only);
    const missing = options.only.filter((id) => !cases.some((c) => c.id === id));
    if (missing.length) throw new Error(`--id names unknown case(s): ${missing.join(', ')}`);
    selected = selected.filter((c) => wanted.has(c.id));
  }
  if (!selected.length) throw new Error('the selected filters matched no cases');

  selected.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ── coverage notice ───────────────────────────────────────────────────────
  const covered = new Set(selected.map((c) => c.series));
  const uncovered = EVAL_SERIES.filter((s) => !covered.has(s));
  if (uncovered.length) warnings.push(`no coverage for series: ${uncovered.join(', ')}`);

  if (!selected.some((c) => c.severity === 'critical')) {
    warnings.push('no critical-severity case in the selection — the suite can pass without testing a guardrail');
  }

  return {
    version: readSuiteVersion(root),
    // Hash the cases the RUN's tier covers — not the filtered selection, and not
    // blindly the whole corpus.
    //
    //   - Not the filtered selection (--id / --series): a one-case check must stay
    //     comparable to a full run, so narrowing a run cannot change its identity.
    //   - Not the whole corpus either: a context-tier score must not be invalidated
    //     because somebody edited a behaviour case. Per-tier scoping is what keeps
    //     the free tier's baseline usable while the paid tier's cases are still
    //     being written.
    hash: suiteHashFor(options.tiers?.length ? cases.filter((c) => options.tiers!.includes(c.tier)) : cases),
    cases: selected,
    warnings,
  };
}

/** All case ids, for the self-test and for --id validation. */
export function allCaseIds(dir?: string): string[] {
  return loadSuite({ dir }).cases.map((c) => c.id);
}
