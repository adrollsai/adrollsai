import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cronAuthGuard } from '@/lib/agent/harness/cron-auth';
import { loadSuite } from '@/lib/evals/cases';
import { applyBaseline, summariseRun } from '@/lib/evals/metrics';
import { EvalStore } from '@/lib/evals/store';
import { resolveEvalProfile, runSuite } from '@/lib/evals/runner';
import { EVAL_SERIES, type EvalTier } from '@/lib/evals/types';

/**
 * The eval ratchet, on a schedule.
 *
 * WHY THIS EXISTS
 * An eval suite that runs only when a human types a command is a drawer ornament,
 * and a worse-than-none one: people believe it is protecting them. `vercel.json`
 * schedules this route so the agent is measured whether or not anybody remembers.
 *
 * WHAT RUNS WHEN
 *   daily    `?tier=context`   — free, no model call, ~5s. Asserts the agent is
 *                                still GIVEN the right tools and guardrails.
 *   weekly   `?tier=behaviour&judge=1` — real model turns. Asserts what it DOES.
 *
 * WHY THE TWO TIERS ARE SPLIT THIS WAY
 * The context tier costs nothing, so it can afford to run every day and catch the
 * cheapest class of regression (a tool group silently dropping a guardrail) within
 * 24 hours. The behaviour tier costs real money per run, so it runs weekly and is
 * capped; `maxCostInr` defaults to ₹200 and a wall-clock deadline stops dispatch
 * before the platform kills the invocation.
 *
 * SAFETY: it refuses to run the behaviour tier without a throwaway account. Those
 * cases deliberately provoke sending, spending and domain writes — pointing them
 * at "whichever profile happens to be first" would message a real customer.
 *
 * FAILURE IS LOUD ON PURPOSE. A breach or regression returns HTTP 500 so Vercel
 * marks the invocation failed, records an AGENT_EVAL_ALERT event, and — when
 * AGENT_EVAL_ALERT_USER_ID is configured — pushes/emails the owner. A green cron
 * that quietly found a broken guardrail would be the worst possible outcome.
 */

/** Long, like harness-runner: a behaviour sweep is many sequential model turns. */
export const maxDuration = 1800;

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/** Stop dispatching new cases this long before the platform's hard timeout. */
const DEADLINE_HEADROOM_MS = 120_000;
const RUN_BUDGET_MS = maxDuration * 1000 - DEADLINE_HEADROOM_MS;

function num(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Narrow an unknown thrown value to a message, so catch clauses need no `any`. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const guard = cronAuthGuard(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const tierRaw = (url.searchParams.get('tier') || 'context').toLowerCase();
  if (tierRaw !== 'context' && tierRaw !== 'behaviour') {
    return NextResponse.json(
      { error: `unknown tier "${tierRaw}" — use context or behaviour` },
      { status: 400 }
    );
  }
  const tier = tierRaw as EvalTier;
  const judge = url.searchParams.get('judge') === '1' || url.searchParams.get('judge') === 'true';
  const repeat = Math.max(1, Math.min(5, Math.floor(num(url.searchParams.get('repeat'), 1))));
  // The paid tier is capped by default. A cron with no cap is an unbounded bill.
  const maxCostInr = num(url.searchParams.get('maxCostInr'), tier === 'behaviour' ? 200 : 0);

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    return NextResponse.json({ error: 'Supabase env is not configured' }, { status: 503 });
  }
  const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

  // ── corpus ────────────────────────────────────────────────────────────────
  let suite;
  try {
    suite = loadSuite({ tiers: [tier] });
  } catch (err) {
    // An invalid corpus is an engineering emergency, not a normal failure: the
    // suite cannot measure anything until somebody fixes a case file.
    console.error('[evals-cron] the eval corpus is invalid:', messageOf(err));
    return NextResponse.json(
      { error: 'eval corpus invalid — nothing was measured', detail: String(messageOf(err)).slice(0, 2000) },
      { status: 500 }
    );
  }

  // ── who to run against ────────────────────────────────────────────────────
  const profile = await resolveEvalProfile(sb, { allowAnyForReadOnly: tier === 'context' });
  if (!profile) {
    const detail =
      tier === 'behaviour'
        ? 'No safe test profile. Set AGENT_TEST_PROFILE_ID or create an @nobogent.test account. Refusing to provoke send/spend behaviour against a real customer.'
        : 'No profile in the database to build an agent context from.';
    console.error('[evals-cron]', detail);
    return NextResponse.json({ error: detail }, { status: 409 });
  }

  // ── run ───────────────────────────────────────────────────────────────────
  const store = EvalStore.connect();
  const runId = await store.startRun({
    tier,
    suiteVersion: suite.version,
    suiteHash: suite.hash,
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    modelPrimary: null,
    judgeModel: judge ? process.env.EVAL_JUDGE_MODEL || 'gemini' : null,
    profileId: profile.id,
    repeat,
  });

  const baseline = await store.baselineFor(tier, suite.hash, runId);

  let outcome;
  try {
    outcome = await runSuite({
      sb,
      userId: profile.id,
      tier,
      repeat,
      judge,
      maxCostInr,
      deadlineAt: Date.now() + RUN_BUDGET_MS,
      // Sequential on the paid tier: predictable spend beats a faster report.
      concurrency: tier === 'context' ? 4 : 1,
      store,
      runId,
    }, suite.cases);
  } catch (err) {
    console.error('[evals-cron] the suite crashed:', messageOf(err));
    if (runId) await store.markStale(runId, String(messageOf(err)));
    return NextResponse.json({ error: 'eval suite crashed', detail: String(messageOf(err)).slice(0, 2000) }, { status: 500 });
  }

  // ── score ─────────────────────────────────────────────────────────────────
  const withBaseline = applyBaseline(outcome.results, baseline?.outcomes ?? null);
  const summary = summariseRun({
    results: withBaseline,
    tier,
    suiteVersion: suite.version,
    suiteHash: suite.hash,
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    modelPrimary: outcome.servedModel,
    judgeModel: judge ? process.env.EVAL_JUDGE_MODEL || 'gemini' : null,
    profileId: profile.id,
    repeat,
    seriesList: EVAL_SERIES,
  });

  const partial = outcome.budgetExceeded || outcome.deadlineExceeded;
  const notes: string[] = [];
  if (outcome.budgetExceeded) notes.push('budget cap reached — partial run');
  if (outcome.deadlineExceeded) notes.push('wall-clock deadline reached — partial run');
  if (!store.available) notes.push(`history unavailable: ${store.reason ?? 'no store'}`);

  if (runId) {
    await store.finishRun(runId, summary, partial ? 'aborted' : 'completed', {
      baselineRunId: baseline?.runId ?? null,
      notes: notes.join('; ') || undefined,
    });
  }

  const failures = withBaseline.filter((r) => !r.passed);

  console.log(
    `[evals-cron] ${tier} run ${runId ?? '(unpersisted)'}: ${summary.passedCases}/${summary.totalCases} ` +
      `${summary.verdict.toUpperCase()} breaches=${summary.guardrailBreaches} regressions=${summary.regressions} ` +
      `cost=₹${summary.totalCostInr.toFixed(4)}${partial ? ' PARTIAL' : ''}`
  );

  const payload = {
    runId,
    tier,
    verdict: summary.verdict,
    passRate: summary.passRate,
    passed: `${summary.passedCases}/${summary.totalCases}`,
    guardrailBreaches: summary.guardrailBreaches,
    regressions: summary.regressions,
    flaky: summary.flakyCases,
    costInr: summary.totalCostInr,
    model: summary.modelPrimary,
    suiteHash: suite.hash.slice(0, 16),
    partial,
    failures: failures.slice(0, 20).map((f) => ({
      case: f.caseId,
      severity: f.severity,
      breach: f.guardrailBreach,
      reasons: f.failureReasons.slice(0, 3),
    })),
  };

  // ── alert ─────────────────────────────────────────────────────────────────
  // A breach or a regression is a release blocker, so it is reported in three ways:
  // a 500 (Vercel flags the invocation), a durable agent_events row (queryable
  // history), and — if configured — a push/email to the owner. WhatsApp is skipped
  // deliberately: that is a customer channel, not an engineering pager.
  const mustAlert = summary.verdict !== 'pass';
  if (mustAlert && !partial) {
    await recordAlert(sb, profile.id, payload);
  }

  return NextResponse.json(payload, { status: mustAlert && !partial ? 500 : 200 });
}

/** Durable record of an eval alert. Never throws — a failed alert must not mask the verdict. */
async function recordAlert(
  // Typed loosely on purpose. The generated supabase/database.types.ts is stale (it has no
  // `agent_events` insert shape), so typing this against it makes the insert argument resolve
  // to `never` and `tsc` fails the build — a false error about correct code. Same choice
  // app/api/cron/video-watchdog/route.ts documents at the top of its file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  fallbackUserId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const headline =
    payload.guardrailBreaches
      ? `Agent eval: ${payload.guardrailBreaches} GUARDRAIL BREACH(ES)`
      : `Agent eval regressed: ${payload.passed} cases passing`;

  const body =
    `${headline}. Verdict ${payload.verdict} on the ${payload.tier} tier (${payload.passed}). ` +
    `${payload.regressions} regression(s), ${payload.costInr} ₹ spent. ` +
    `Run ${payload.runId ?? '(unpersisted)'}.`;

  try {
    await sb.from('agent_events').insert({
      user_id: fallbackUserId,
      event_type: 'AGENT_EVAL_ALERT',
      scheduled_for: new Date().toISOString(),
      payload: { ...payload, headline, body },
      status: 'completed',
    });
  } catch (err) {
    console.warn('[evals-cron] could not record the alert event:', messageOf(err));
  }

  // Optional push/email. Kept behind an env var so this route never invents a
  // recipient: alerting the wrong person is worse than not alerting.
  const alertUser = (process.env.AGENT_EVAL_ALERT_USER_ID || '').trim();
  if (!alertUser) return;

  try {
    const { sendAdminMultiChannelNotification } = await import('@/utils/notification-helper');
    await sendAdminMultiChannelNotification({
      ownerUserId: alertUser,
      title: headline,
      body,
      url: '/dashboard',
      skipWhatsApp: true,
    });
  } catch (err) {
    console.warn('[evals-cron] could not send the owner alert:', messageOf(err));
  }
}
