/**
 * Types for the agent eval system.
 *
 * Kept dependency-free on purpose: `metrics.ts` (the scoring maths) imports from
 * here, and `scripts/verify-evals.ts` tests the maths with no network, no model
 * and no database. If the scoring rules cannot be tested cheaply they will not be
 * trusted, and an untrusted score is worse than no score.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The categories a case can belong to.
 *
 * Fixed rather than free text because the per-series rollup is the number a human
 * reads: a single headline pass rate hides exactly the regression that matters
 * (90% -> 92% overall while `safety` fell 100% -> 80% is a net disaster). A closed
 * set is what makes those rollups comparable across runs and across months.
 */
export const EVAL_SERIES = [
  'safety',
  'reporting',
  'crm',
  'creative',
  'ads',
  'publishing',
  'sites',
  'automation',
  'skills',
  'research',
  'vision',
  'notifications',
  'billing',
  'reliability',
] as const;

export type EvalSeries = (typeof EVAL_SERIES)[number];

/** Which half of the suite a case belongs to. */
export type EvalTier = 'context' | 'behaviour';

/**
 * How much a case matters, and therefore how much a failure costs.
 *
 *  critical  spends money, reaches a customer, destroys data, or is a hard
 *            safety rule. A critical failure fails the entire run.
 *  high      the agent gets the job wrong in a way the owner notices and has to
 *            correct by hand.
 *  normal    quality and polish.
 */
export type EvalSeverity = 'critical' | 'high' | 'normal';

/**
 * Assertion weight by severity.
 *
 * Uneven on purpose: within a case, missing "never bulk-message without approval"
 * must not be diluted by passing three cosmetic checks. A flat weight per
 * assertion would score a guardrail miss the same as a wording miss.
 */
export const SEVERITY_WEIGHT: Record<EvalSeverity, number> = {
  critical: 5,
  high: 2,
  normal: 1,
};

// ---------------------------------------------------------------------------
// Case definitions (what lives in evals/cases/*.json)
// ---------------------------------------------------------------------------

/**
 * A case as authored on disk.
 *
 * Field names are deliberately descriptive rather than minimal: a case file is
 * read by whoever is adding the next one, and `forbidTools` says what it means
 * where `forbidden` would not.
 *
 * Regexes are stored as SOURCE STRINGS because JSON has no RegExp literal. They
 * are compiled (case-insensitively) and validated when the suite loads, so a bad
 * pattern is a load-time error naming the case, never a silent non-match at
 * runtime.
 */
export interface EvalCaseFile {
  /** Stable kebab-case id. The trend is keyed on this, so renaming resets history. */
  id: string;
  title: string;
  series: EvalSeries;
  severity: EvalSeverity;
  tier: EvalTier;
  /** The exact text the owner would send. */
  prompt: string;
  /** Why this case exists. This is the domain knowledge that makes the suite an asset. */
  notes?: string;

  // ── context tier: deterministic, no model call, free ──────────────────────
  /** Tools that must be in the toolset the model receives. */
  mustExpose?: string[];
  /** Tools that must NOT be present at all. Absence, not discouragement. */
  mustNotExpose?: string[];
  /** Regex source strings that must appear in the system prompt. */
  promptMust?: string[];
  /** Regex source strings that must NOT appear in the system prompt. */
  promptMustNot?: string[];

  // ── behaviour tier: one live model turn, costs money ──────────────────────
  /** Correct first moves. At least one must be called. */
  expectAnyTool?: string[];
  /** Tools that must never be called for this request. */
  forbidTools?: string[];
  /** The reply must match. Use for "reads as a refusal". */
  replyMust?: string[];
  /** The reply must not match. Use for "claims an action it did not take". */
  replyMustNot?: string[];
  /** The turn must finish within this many tool steps. */
  maxSteps?: number;
  /** The turn must cost at most this much (INR, our vendor cost). */
  maxCostInr?: number;
  /**
   * A human must have been put in the loop before anything irreversible happened.
   *
   * Deliberately a DISJUNCTION, because there are two correct ways to do this and
   * only one wrong one:
   *   - the agent asked up front (`request_human_approval` / `request_user_input`), or
   *   - the agent reached for a gated tool and the review gate intercepted it
   *     (lib/agent/review-gate.ts returns `needs_review`).
   * Both mean a human decides. Asserting only "the gate must fire" would mark the
   * better behaviour — asking before reaching — as a failure, which would train us
   * to ignore the suite.
   */
  expectApprovalPath?: boolean;
  /** Run the LLM judge on the free-text reply. */
  judge?: boolean;
  /** Per-case override of the suite-wide repeat count. */
  repeat?: number;
}

// ---------------------------------------------------------------------------
// Observation (what the runner measured)
// ---------------------------------------------------------------------------

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  /** Cached input tokens, billed ~50x cheaper. */
  cacheReadTokens: number;
}

/**
 * Everything observed while running one case.
 *
 * One wide optional bag rather than a union per tier, because the alternative is
 * a discriminated union the metrics functions have to narrow at every line for no
 * real safety gain — the tier is already recorded on the case.
 */
export interface CaseObservation {
  exposedTools?: string[];
  systemPrompt?: string;
  toolsCalled?: string[];
  reply?: string;
  steps?: number;
  usage?: UsageSnapshot;
  costInr?: number;
  latencyMs?: number;
  servedModel?: string | null;
  /** True when the review gate returned a needs_review result for some tool. */
  approvalGateHit?: boolean;
  /** Transport/provider error. A errored turn is a failed case, never a skipped one. */
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Assertions and results
// ---------------------------------------------------------------------------

/**
 * One graded check.
 *
 * `weight` is carried on the assertion rather than looked up later so a stored
 * result explains its own score years after the severity table may have changed.
 */
export interface Assertion {
  key: string;
  ok: boolean;
  weight: number;
  detail?: string;
}

export interface JudgeCriterionScore {
  /** 0..3. 0 = wrong or fabricated, 3 = exactly what the owner needed. */
  score: number;
  reason?: string;
}

export interface JudgeResult {
  /** Criterion id -> score. Ids come from evals/rubrics/reply-quality.md. */
  criteria: Record<string, JudgeCriterionScore>;
  /** Mean of the criterion scores, 0..3. */
  overall: number;
  verdict: 'pass' | 'fail';
  reasoning: string;
  model: string;
  /** Set when the judge itself failed; the case keeps its deterministic verdict. */
  error?: string;
}

export type EvalTransition = 'same' | 'regression' | 'improvement' | 'new';

/** The full outcome of one case, including all repeats. */
export interface EvalCaseResult {
  caseId: string;
  title: string;
  series: EvalSeries;
  severity: EvalSeverity;
  tier: EvalTier;
  passed: boolean;
  /** 0..1 weighted score of the final attempt. */
  score: number;
  guardrailBreach: boolean;
  toolAccuracy: number | null;
  steps: number | null;
  tokensIn: number;
  tokensOut: number;
  costInr: number;
  latencyMs: number | null;
  servedModel: string | null;
  approvalGateHit: boolean;
  assertions: Assertion[];
  failureReasons: string[];
  toolsCalled: string[];
  replyExcerpt: string;
  judge: JudgeResult | null;
  flaky: boolean;
  repeatPassed: number;
  repeatTotal: number;
  error: string | null;

  // Filled in by the regression comparison, not by the runner.
  baselinePassed?: boolean | null;
  transition?: EvalTransition;
}

// ---------------------------------------------------------------------------
// Run aggregate
// ---------------------------------------------------------------------------

export interface SeriesRollup {
  series: EvalSeries;
  total: number;
  passed: number;
  score: number;
  breaches: number;
}

export type RunVerdict = 'pass' | 'regressed' | 'fail';

export interface EvalRunSummary {
  tier: EvalTier | 'all';
  suiteVersion: string;
  suiteHash: string;
  gitSha: string | null;
  modelPrimary: string | null;
  judgeModel: string | null;
  profileId: string | null;
  repeat: number;

  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  weightedScore: number;
  guardrailBreaches: number;
  flakyCases: number;

  totalCostInr: number;
  totalTokensIn: number;
  totalTokensOut: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;

  bySeries: SeriesRollup[];
  regressions: number;
  improvements: number;
  verdict: RunVerdict;
  /** True when a critical case failed or a guardrail was breached. */
  criticalFailure: boolean;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export const emptyUsage = (): UsageSnapshot => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
});

export function addUsage(a: UsageSnapshot, b: UsageSnapshot): UsageSnapshot {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}
