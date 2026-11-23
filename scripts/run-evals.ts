/* eslint-disable @typescript-eslint/no-explicit-any --
 * CLI script: reads untyped Supabase rows and arbitrary thrown values. There is no generated type for the eval tables yet.
 */
/**
 * Run the agent eval suite.
 *
 *   npm run eval:context                     free, instant, no model call
 *   npm run eval:behaviour -- --judge        live turns, costs money
 *   npm run eval:all -- --judge              both
 *
 *   npm run eval:context -- --list           show the cases and exit
 *   npm run eval:context -- --id=a,b         run named cases
 *   npm run eval:behaviour -- --series=safety
 *   npm run eval:behaviour -- --repeat=3     measure flakiness
 *   npm run eval:behaviour -- --max-cost-inr=25
 *   npm run eval:all -- --fail-on-regression
 *
 * EXIT CODES — deliberately distinct so CI can tell "broken" from "slipped":
 *   0  pass
 *   1  fail       (a guardrail was breached or a critical case failed)
 *   2  regressed  (clean, but something that passed before does not now)
 *   3  the suite itself could not run (bad case file, no database, unknown id)
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadSuite } from '../lib/evals/cases';
import { applyBaseline, summariseRun } from '../lib/evals/metrics';
import { EvalStore } from '../lib/evals/store';
import { resolveEvalProfile, runSuite } from '../lib/evals/runner';
import { printRunReport, writeArtifacts, type ReportMeta } from '../lib/evals/report';
import { EVAL_SERIES, type EvalSeries, type EvalTier, type RunVerdict } from '../lib/evals/types';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  if (hit === `--${name}`) return 'true';
  return hit.slice(name.length + 3);
}

const flag = (name: string) => arg(name) === 'true';
const list = (name: string): string[] | undefined => {
  const raw = arg(name);
  if (!raw || raw === 'true') return undefined;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};
const num = (name: string, fallback: number): number => {
  const raw = arg(name);
  if (raw === undefined || raw === 'true') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
};

const tierArg = (arg('tier') ?? 'context') as EvalTier | 'all';
if (!['context', 'behaviour', 'all'].includes(tierArg)) {
  console.error(`--tier must be context, behaviour or all (got "${tierArg}")`);
  process.exit(3);
}

const includeBehaviour = tierArg === 'behaviour' || tierArg === 'all';
const includeContext = tierArg === 'context' || tierArg === 'all';

const op = {
  repeat: Math.max(1, Math.floor(num('repeat', 1))),
  judge: flag('judge'),
  // A guard, not a suggestion: the paid tier defaults to a hard cap so a mistyped
  // command cannot quietly run the whole live suite.
  maxCostInr: num('max-cost-inr', includeBehaviour ? 200 : 0),
  concurrency: Math.max(1, Math.floor(num('concurrency', includeBehaviour ? 1 : 4))),
  failOnRegression: flag('fail-on-regression'),
  baselineOverride: arg('baseline'),
  noBaseline: flag('no-baseline'),
  noStore: flag('no-store'),
  json: flag('json'),
};

function gitSha(): string | null {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  // ── load the corpus ───────────────────────────────────────────────────────
  const seriesFilter = list('series') as EvalSeries[] | undefined;
  if (seriesFilter) {
    const bad = seriesFilter.filter((s) => !EVAL_SERIES.includes(s));
    if (bad.length) {
      console.error(`--series names unknown series: ${bad.join(', ')}\nknown: ${EVAL_SERIES.join(', ')}`);
      process.exit(3);
    }
  }

  const tiers: EvalTier[] = includeBehaviour && includeContext ? ['context', 'behaviour'] : [includeBehaviour ? 'behaviour' : 'context'];

  let suite;
  try {
    suite = loadSuite({ tiers, series: seriesFilter, only: list('id') });
  } catch (err: any) {
    console.error(`\nCannot run — the eval corpus is invalid:\n\n${err?.message || err}\n`);
    process.exit(3);
  }

  if (flag('list')) {
    console.log(`suite ${suite.version}  hash ${suite.hash.slice(0, 16)}  ${suite.cases.length} case(s)\n`);
    for (const c of suite.cases) {
      console.log(`  ${c.tier === 'context' ? 'ctx' : 'LIVE'}  ${c.id}  [${c.series}/${c.severity}]  ${c.title}`);
    }
    return;
  }

  // ── database ──────────────────────────────────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('No Supabase credentials in .env.local — createAgentContext needs a real profile.');
    process.exit(3);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const profile = await resolveEvalProfile(sb, { allowAnyForReadOnly: !includeBehaviour });
  if (!profile) {
    if (includeBehaviour) {
      console.error(
        'No safe test profile for the behaviour tier.\n' +
          'Set AGENT_TEST_PROFILE_ID to a throwaway account, or create one with an @nobogent.test email.\n' +
          'Refusing to run provocative scenarios against a real customer.'
      );
    } else {
      console.error('No profile at all in the database — cannot build an agent context.');
    }
    process.exit(3);
  }

  const store = op.noStore ? null : EvalStore.connect();

  console.log('');
  console.log(`suite      ${suite.version} (${suite.hash.slice(0, 12)})`);
  console.log(`tier       ${tierArg} · ${suite.cases.length} case(s)` + (op.repeat > 1 ? ` · repeat ${op.repeat}` : ''));
  console.log(`profile    ${profile.label}`);
  console.log(`judge      ${op.judge ? 'on' : 'off'}`);
  if (op.maxCostInr > 0) console.log(`budget     ${'₹'}${op.maxCostInr} cap`);
  for (const w of suite.warnings) console.log(`note       ${w}`);

  // ── baseline ──────────────────────────────────────────────────────────────
  let baseline: { runId: string; startedAt: string; outcomes: Map<string, boolean> } | null = null;
  if (!op.noBaseline && store) {
    if (op.baselineOverride && op.baselineOverride !== 'true') {
      const outcomes = await store.loadBaselineById(op.baselineOverride);
      if (outcomes) baseline = { runId: op.baselineOverride, startedAt: outcomes.startedAt, outcomes: outcomes.outcomes };
    } else {
      baseline = await store.baselineFor(tierArg, suite.hash);
    }
  }

  // ── open the run ──────────────────────────────────────────────────────────
  const startedAt = new Date();
  const runId = store
    ? await store.startRun({
        tier: tierArg,
        suiteVersion: suite.version,
        suiteHash: suite.hash,
        gitSha: gitSha(),
        modelPrimary: null, // filled in after the runner resolves it
        judgeModel: op.judge ? (process.env.EVAL_JUDGE_MODEL || 'gemini') : null,
        profileId: profile.id,
        repeat: op.repeat,
      })
    : null;

  // ── run ───────────────────────────────────────────────────────────────────
  console.log('');
  let outcome;
  try {
    outcome = await runSuite(
      {
        sb,
        userId: profile.id,
        tier: tierArg,
        repeat: op.repeat,
        judge: op.judge,
        maxCostInr: op.maxCostInr,
        concurrency: op.concurrency,
        store,
        runId,
        onCase: (r, i, total) => {
          const mark = r.passed ? 'ok  ' : r.guardrailBreach ? 'BREACH' : 'FAIL';
          const cost = r.costInr ? `₹${r.costInr.toFixed(3)}` : '—';
          console.log(
            `  [${String(i).padStart(2)}/${total}] ${mark}  ${r.caseId}  (${cost}${r.steps !== null ? `, ${r.steps} steps` : ''})`
          );
          if (!r.passed) for (const reason of r.failureReasons.slice(0, 3)) console.log(`           · ${reason}`);
        },
      },
      suite.cases
    );
  } catch (err: any) {
    console.error(`\nThe suite crashed: ${err?.message || err}`);
    if (runId && store) await store.markStale(runId, String(err?.message || err));
    process.exit(3);
  }

  // ── score ─────────────────────────────────────────────────────────────────
  const withBaseline = applyBaseline(outcome.results, baseline?.outcomes ?? null);

  const summary = summariseRun({
    results: withBaseline,
    tier: tierArg,
    suiteVersion: suite.version,
    suiteHash: suite.hash,
    gitSha: gitSha(),
    modelPrimary: outcome.servedModel,
    judgeModel: op.judge ? (process.env.EVAL_JUDGE_MODEL || 'gemini') : null,
    profileId: profile.id,
    repeat: op.repeat,
    seriesList: EVAL_SERIES,
  });

  const finishedAt = new Date();
  const notes: string[] = [];
  if (outcome.budgetExceeded) notes.push('budget cap reached — partial run');
  if (outcome.deadlineExceeded) notes.push('wall-clock deadline reached — partial run');
  if (!store || !store.available) notes.push(`history unavailable: ${store?.reason ?? 'no store'}`);
  // A filtered run hashes against the FULL corpus on purpose (so a one-case check
  // stays comparable), which means its passed/total looks like a whole-suite score
  // to anyone reading the trend later. Say so explicitly.
  if (list('id') || seriesFilter) {
    notes.push(
      `filtered run — ids=[${list('id')?.join(',') ?? ''}] series=[${seriesFilter?.join(',') ?? ''}] of ${suite.cases.length} selected`
    );
  }

  if (runId && store) {
    await store.finishRun(runId, summary, outcome.budgetExceeded || outcome.deadlineExceeded ? 'aborted' : 'completed', {
      baselineRunId: baseline?.runId ?? null,
      notes: notes.join('; ') || undefined,
    });
  }

  // ── report ────────────────────────────────────────────────────────────────
  const meta: ReportMeta = {
    startedAt,
    finishedAt,
    baselineRunId: baseline?.runId ?? null,
    baselineStartedAt: baseline?.startedAt ?? null,
    runId,
    persisted: Boolean(runId),
    persistNote: store?.reason ?? null,
    budgetExceeded: outcome.budgetExceeded,
    warnings: baseline ? [] : ['no baseline run found — this run is the new baseline'],
  };

  printRunReport(withBaseline, summary, meta);

  const artifacts = writeArtifacts(withBaseline, summary, meta);
  if (artifacts.mdPath) {
    console.log(`report  ${artifacts.mdPath}`);
    console.log(`data    ${artifacts.jsonPath}`);
  }
  if (runId) console.log(`run id  ${runId}`);
  console.log('');

  if (op.json) {
    console.log(JSON.stringify({ summary, runId, artifacts }, null, 2));
  }

  // ── exit code ─────────────────────────────────────────────────────────────
  const verdict: RunVerdict = summary.verdict;
  if (verdict === 'fail') process.exit(1);
  if (verdict === 'regressed' && op.failOnRegression) process.exit(2);
  process.exit(0);
})().catch((err) => {
  console.error('\nUnhandled failure:', err?.stack || err?.message || err);
  process.exit(3);
});
