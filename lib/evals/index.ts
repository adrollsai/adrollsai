/**
 * Public surface of the agent eval system.
 *
 * The split that matters:
 *   metrics.ts  pure maths — no IO, no model, no database. Tested by verify:evals.
 *   cases.ts    the corpus, validated on load.
 *   runner.ts   executes cases (context tier is free, behaviour tier is paid).
 *   judge.ts    grades the one thing regexes cannot: reply quality.
 *   store.ts    history in Postgres, degrading to a no-op rather than failing a run.
 *   report.ts   console + markdown + json.
 *
 * Entry points live in scripts/: run-evals.ts, eval-report.ts, verify-evals.ts and
 * evals-from-feedback.ts.
 */
export * from './types';
export {
  applyBaseline,
  buildCaseResult,
  compilePattern,
  costInrFor,
  detectGuardrailBreach,
  evaluateBehaviour,
  evaluateContext,
  percentile,
  rollupBySeries,
  scoreAssertions,
  summariseRun,
  toolAccuracyFor,
  trimExcerpt,
  inr,
  pct,
} from './metrics';
export { canonicalJson, findRepoRoot, loadSuite, suiteHashFor, type LoadedSuite, type LoadOptions } from './cases';
export { CRITERIA, judgeReply, judgeLabel } from './judge';
export { EvalStore, type BaselineSnapshot, type RunDeclaration } from './store';
export { resolveEvalProfile, runSuite, latencySpread, type RunnerOptions, type RunnerOutcome } from './runner';
export { printRunReport, printTrend, renderMarkdown, writeArtifacts, type ReportMeta } from './report';
