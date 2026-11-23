/* eslint-disable @typescript-eslint/no-explicit-any --
 * The AI SDK's generateText result is loosely typed (steps, totalUsage, toolResults, the onStepFinish step argument) and those shapes move between minor versions. Narrowing them here would break on an SDK bump rather than on a real bug. Every such value is normalised into a typed CaseObservation immediately after it is read, so the `any` never escapes this file.
 */
/**
 * The eval runner: turns cases into measurements.
 *
 * Two tiers, deliberately split by cost and by what they can prove.
 *
 *   context    Free, instant, no model call. Asserts what the agent is GIVEN —
 *              which tools, which guardrails. A missing guardrail is a bug
 *              regardless of what the model would have done, so this tier can run
 *              on every commit and costs nothing.
 *
 *   behaviour  One real model turn per repeat per case. Assertions about what the
 *              agent DID: which tools it reached for, whether the reply claims
 *              something untrue, whether the review gate intercepted a spend.
 *              Costs money, so it is budget-capped and requires a throwaway
 *              account.
 *
 * TWO DESIGN RULES THAT MATTER MORE THAN THE CODE
 *
 *  1. NO TEMPERATURE OVERRIDE BY DEFAULT. It is tempting to pin temperature to 0
 *     for tidy, repeatable scores, but an eval that measures settings customers
 *     do not run measures nothing. Production defaults are used, and variance is
 *     handled honestly with `--repeat`, which reports a case that passes 2 of 3 as
 *     flaky rather than as a pass. `EVAL_TEMPERATURE` exists for deliberate
 *     determinism experiments, not as a default.
 *
 *  2. THE PROFILE MUST BE THROWAWAY. Behaviour cases deliberately provoke sending,
 *     spending and domain writes. verify-live-scenarios.ts already learned this —
 *     never default to "whichever profile happens to be first", because that is a
 *     real customer. The same refusal is enforced here.
 */
import { generateText, stepCountIs } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAgentContext } from '../agent/orchestrator';
import { getAgentModel, isDeepseekAuthorized } from '../agent/deepseek';
import { AGENT_MODEL, VIDEO_ANALYSIS_MODEL } from '../agent/models';
import {
  buildCaseResult,
  costInrFor,
  evaluateBehaviour,
  evaluateContext,
  percentile,
} from './metrics';
import { judgeReply } from './judge';
import type { EvalStore } from './store';
import {
  addUsage,
  emptyUsage,
  type Assertion,
  type CaseObservation,
  type EvalCaseFile,
  type EvalCaseResult,
  type EvalTier,
  type UsageSnapshot,
} from './types';

/** Ceiling on tool steps for one turn, mirroring verify-live-scenarios.ts. */
const DEFAULT_STEP_CEILING = 12;

export interface RunnerOptions {
  sb: SupabaseClient;
  userId: string;
  tier: EvalTier | 'all';
  repeat: number;
  judge: boolean;
  /** Hard budget in INR. 0 disables the guard. */
  maxCostInr: number;
  /**
   * Wall-clock deadline (epoch ms). A serverless invocation has a hard timeout, and
   * being killed mid-case leaves a 'running' row and no scorecard. Stopping one case
   * early and finishing cleanly is far better than being killed with nothing
   * recorded — the same reasoning as WORKER_BUDGET_MS in app/api/cron/harness-runner.
   * 0/undefined disables the guard (CLI runs, where a human is watching).
   */
  deadlineAt?: number;
  concurrency: number;
  store?: EvalStore | null;
  runId?: string | null;
  /** Called after each case settles, for progressive console output. */
  onCase?: (result: EvalCaseResult, index: number, total: number) => void;
}

export interface RunnerOutcome {
  results: EvalCaseResult[];
  /** True when the budget guard stopped the suite before every case ran. */
  budgetExceeded: boolean;
  /** True when the wall-clock deadline stopped the suite before every case ran. */
  deadlineExceeded: boolean;
  spentInr: number;
  servedModel: string | null;
}

/**
 * Resolve the account the suite runs against.
 *
 * Order matters: an explicit AGENT_TEST_PROFILE_ID always wins, then a profile on
 * the reserved `@nobogent.test` domain. Anything else is a real customer.
 */
export async function resolveEvalProfile(
  sb: SupabaseClient,
  opts: { allowAnyForReadOnly: boolean }
): Promise<{ id: string; label: string } | null> {
  const wanted = (process.env.AGENT_TEST_PROFILE_ID || '').trim();

  if (wanted) {
    const { data } = await sb
      .from('profiles')
      .select('id, business_name')
      .eq('id', wanted)
      .maybeSingle();
    if (data?.id) return { id: data.id, label: `${data.business_name ?? 'test profile'} (${String(data.id).slice(0, 8)}…)` };
  }

  const { data: testProfile } = await sb
    .from('profiles')
    .select('id, business_name')
    .like('email', '%@nobogent.test')
    .limit(1)
    .maybeSingle();
  if (testProfile?.id) {
    return {
      id: testProfile.id,
      label: `${testProfile.business_name ?? 'test profile'} (${String(testProfile.id).slice(0, 8)}…)`,
    };
  }

  // Context tier only reads the context. It provokes nothing, spends nothing and
  // writes nothing, so any profile is safe — and refusing to run the free tier
  // because no throwaway account exists would remove the only tier that can run
  // unattended on every commit.
  if (opts.allowAnyForReadOnly) {
    const { data: anyProfile } = await sb
      .from('profiles')
      .select('id, business_name')
      .limit(1)
      .maybeSingle();
    if (anyProfile?.id) {
      return {
        id: anyProfile.id,
        label: `${anyProfile.business_name ?? 'profile'} (${String(anyProfile.id).slice(0, 8)}…) — context tier only, nothing was called`,
      };
    }
  }

  return null;
}

/**
 * Which model the agent will actually serve on.
 *
 * Mirrors getAgentModel()'s decision (DeepSeek when the key is authorised, pinned
 * Gemini Flash otherwise) without calling it, so the run can record the model
 * BEFORE the first turn. `verify:parity` already asserts the fallback constant in
 * deepseek.ts equals VIDEO_ANALYSIS_MODEL, so this cannot drift from the real
 * behaviour unnoticed.
 */
async function resolveServedModel(): Promise<string> {
  try {
    const authorised = await isDeepseekAuthorized();
    return authorised ? AGENT_MODEL : VIDEO_ANALYSIS_MODEL;
  } catch {
    return AGENT_MODEL;
  }
}

/** Run one context case. No model call, no cost. */
async function runContextCase(
  sb: SupabaseClient,
  userId: string,
  c: EvalCaseFile
): Promise<{ assertions: Assertion[]; observation: CaseObservation }> {
  const started = Date.now();
  const ctx = await createAgentContext(sb, userId, { intentText: c.prompt });
  const observation: CaseObservation = {
    exposedTools: Object.keys(ctx.tools ?? {}),
    systemPrompt: ctx.systemPrompt ?? '',
    latencyMs: Date.now() - started,
    usage: emptyUsage(),
    costInr: 0,
  };
  return { assertions: evaluateContext(c, observation), observation };
}

/** One live turn. Everything after this treats it as untrusted measurement. */
async function runBehaviourAttempt(
  sb: SupabaseClient,
  userId: string,
  c: EvalCaseFile,
  servedModel: string
): Promise<CaseObservation> {
  const started = Date.now();
  const toolsCalled: string[] = [];
  let reply = '';
  let approvalGateHit = false;
  let stepCount = 0;
  let usage: UsageSnapshot = emptyUsage();

  try {
    const ctx = await createAgentContext(sb, userId, { intentText: c.prompt });
    const model = await getAgentModel();

    // The assertion in `maxSteps` is about efficiency, so the hard stop must be
    // deliberately looser than it — otherwise the budget assertion could never
    // fail and would be decorative.
    const ceiling = Math.max(DEFAULT_STEP_CEILING, (c.maxSteps ?? 0) + 4);

    const temperature = Number(process.env.EVAL_TEMPERATURE ?? '');
    const res = await generateText({
      model,
      system: ctx.systemPrompt,
      prompt: c.prompt,
      tools: ctx.tools as any,
      stopWhen: stepCountIs(ceiling),
      ...(Number.isFinite(temperature) ? { temperature } : {}),
      onStepFinish: (step: any) => {
        stepCount = Math.max(stepCount, Number(step?.stepNumber ?? 0) + 1);
        for (const tc of step?.toolCalls || []) {
          if (tc?.toolName) toolsCalled.push(tc.toolName);
        }
        // The review gate answers a blocked spend/send with { needs_review: true }.
        // Seeing that is proof the gate bit at runtime, which is stronger evidence
        // than "the prompt told it to ask".
        for (const tr of step?.toolResults || []) {
          const out = tr?.output ?? tr?.result;
          if (out && typeof out === 'object' && (out as any).needs_review === true) {
            approvalGateHit = true;
          }
        }
        if (step?.text) reply += `\n${step.text}`;
      },
    });

    reply = String(res.text || reply).trim();

    // stepCount from stepNumber can lag the final step; res.steps is authoritative.
    const steps = Array.isArray((res as any).steps) ? (res as any).steps.length : stepCount;

    const total = (res as any).totalUsage ?? (res as any).usage ?? {};
    usage = {
      inputTokens: Number(total?.inputTokens ?? total?.promptTokens ?? 0),
      outputTokens: Number(total?.outputTokens ?? total?.completionTokens ?? 0),
      cacheReadTokens: Number(
        total?.inputTokenDetails?.cacheReadTokens ?? total?.cachedInputTokens ?? 0
      ),
    };

    // A late-resolving message with no steps at all still produced text; keep steps
    // honest rather than reporting 0 for a turn that clearly ran.
    if (!steps && toolsCalled.length) stepCount = Math.max(stepCount, 1);

    const observation: CaseObservation = {
      toolsCalled,
      reply,
      steps: steps || stepCount,
      usage,
      costInr: costInrFor(usage, servedModel),
      latencyMs: Date.now() - started,
      servedModel,
      approvalGateHit,
      error: null,
    };
    return observation;
  } catch (err: any) {
    // A provider error is a FAILED case, never a skipped one. A suite that reports
    // a stable score during an outage is the most dangerous kind of scoreboard.
    return {
      toolsCalled,
      reply,
      steps: stepCount,
      usage,
      costInr: costInrFor(usage, servedModel),
      latencyMs: Date.now() - started,
      servedModel,
      approvalGateHit,
      error: String(err?.message || err).slice(0, 400),
    };
  }
}

/**
 * Run one case, honouring repeats.
 *
 * A case passes only when EVERY repeat passes. A 2-of-3 result is recorded as
 * `flaky` and treated as a failure: "usually works" is not a property you can sell
 * to someone whose leads are being dialled.
 */
async function runCase(
  opts: RunnerOptions,
  c: EvalCaseFile,
  servedModel: string
): Promise<EvalCaseResult> {
  const repeat = c.repeat ?? opts.repeat;

  if (c.tier === 'context') {
    const { assertions, observation } = await runContextCase(opts.sb, opts.userId, c);
    return buildCaseResult({ case: c, assertions, observation, repeatPassed: 1, repeatTotal: 1 });
  }

  const attempts: { assertions: Assertion[]; observation: CaseObservation }[] = [];
  let repeatPassed = 0;
  let totalUsage = emptyUsage();
  let totalCost = 0;

  for (let i = 0; i < repeat; i++) {
    const observation = await runBehaviourAttempt(opts.sb, opts.userId, c, servedModel);
    const assertions = evaluateBehaviour(c, observation);
    attempts.push({ assertions, observation });

    totalUsage = addUsage(totalUsage, observation.usage ?? emptyUsage());
    totalCost += observation.costInr ?? 0;

    const attemptPassed = assertions.every((a) => a.ok) && !observation.error;
    if (attemptPassed) repeatPassed++;
  }

  // Diagnose with a FAILING attempt when there is one — a flaky case is far easier
  // to fix from the run that broke than from the run that happened to work.
  const representative = attempts.find((a) => !a.assertions.every((x) => x.ok) || a.observation.error)
    ?? attempts[attempts.length - 1];

  // Grade once, on the representative attempt, and on a single-attempt cost basis
  // so the judge never inflates the recorded turn cost.
  let judge = null;
  if (opts.judge && c.judge !== false && representative.observation.reply) {
    judge = await judgeReply({
      prompt: c.prompt,
      reply: representative.observation.reply,
      toolsCalled: representative.observation.toolsCalled ?? [],
    });
    if (!judge.error) totalCost += costInrFor({ inputTokens: 2500, outputTokens: 400, cacheReadTokens: 0 }, judge.model);
  }

  const merged: CaseObservation = {
    ...representative.observation,
    // Report whole-case spend, which is what the budget and the ledger care about.
    costInr: totalCost,
    usage: totalUsage,
  };

  const result = buildCaseResult({
    case: c,
    assertions: representative.assertions,
    observation: merged,
    judge,
    repeatPassed,
    repeatTotal: repeat,
  });

  // Strict: every repeat must pass. buildCaseResult graded one attempt, so override.
  if (repeat > 1) {
    result.passed = repeatPassed === repeat && !representative.observation.error;
    if (!result.passed && result.failureReasons.length === 0) {
      result.failureReasons.push(`flaky: passed ${repeatPassed} of ${repeat} repeats`);
    }
  }

  return result;
}

/** Bounded-concurrency map. Order of results matches the input. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Execute the suite.
 *
 * The budget guard is checked before each case is dispatched. With concurrency > 1
 * it can overshoot by at most (concurrency - 1) cases, which is why the default
 * for the paid tier is 1: predictable spend beats a faster report.
 */
export async function runSuite(opts: RunnerOptions, cases: EvalCaseFile[]): Promise<RunnerOutcome> {
  const servedModel = cases.some((c) => c.tier === 'behaviour') ? await resolveServedModel() : null;
  const results = new Array<EvalCaseResult>(cases.length);
  let spent = 0;
  let budgetExceeded = false;
  let deadlineExceeded = false;
  let settled = 0;

  const limit = cases.every((c) => c.tier === 'context') ? Math.max(1, opts.concurrency) : Math.max(1, Math.min(opts.concurrency, 2));

  await mapLimit(cases, limit, async (c, i) => {
    if (opts.maxCostInr > 0 && spent >= opts.maxCostInr) {
      budgetExceeded = true;
      return;
    }
    // Stop DISPATCHING new cases past the deadline; let the in-flight one finish so
    // its result is real. A partial scorecard that says "partial" is useful; a row
    // killed mid-flight is not.
    if (opts.deadlineAt && Date.now() >= opts.deadlineAt) {
      deadlineExceeded = true;
      return;
    }

    const result = await runCase(opts, c, servedModel ?? AGENT_MODEL);
    results[i] = result;
    spent += result.costInr;

    if (opts.runId && opts.store) {
      // Best-effort: a failed write must not change the measurement.
      await opts.store.saveResult(opts.runId, result);
    }

    settled++;
    opts.onCase?.(result, settled, cases.length);
  });

  const finished = results.filter(Boolean);
  return {
    results: finished,
    budgetExceeded,
    deadlineExceeded,
    spentInr: Math.round(spent * 10000) / 10000,
    servedModel,
  };
}

/** Wall-clock p50/p95 of the run, for the console footer. */
export function latencySpread(results: EvalCaseResult[]): { p50: number | null; p95: number | null } {
  const values = results.map((r) => r.latencyMs).filter((v): v is number => typeof v === 'number');
  return { p50: percentile(values, 50), p95: percentile(values, 95) };
}
