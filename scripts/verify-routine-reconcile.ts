/**
 * GATE: a routine row must end up saying what actually happened to its run.
 *
 * WHY THIS GATE EXISTS
 * `materialiseDueRoutines` wrote `routine_runs.status = 'queued'` and nothing ever wrote the
 * outcome back. Measured on production on 2026-11-26 over the previous seven days: 80 routine
 * rows, 79 `queued`, 1 `failed`, zero `completed` — while every harness run behind them had
 * finished, 42 `completed` and 35 `dead` with `Platform AI provider out of credit (not the
 * customer's balance): Insufficient Balance`. The creative had been made or had failed; the record
 * claimed the day was still waiting.
 *
 * (An earlier version of this comment said the stale status made the nightly rollup read 0. That was
 * wrong — the rollup counts rows regardless of status — and it is corrected here: what the stale
 * status broke was the ledger's meaning, so "not recorded yet" was indistinguishable from "did not
 * run". `verify:digest-honesty` owns the second half of that repair.)
 *
 * This gate pins the mapping and the safety rules, without a database and without a model:
 *   1. a completed run settles its row `completed`;
 *   2. a dead / failed / cancelled run settles it `failed` and CARRIES the provider's error;
 *   3. a run that is still queued or running leaves the row untouched — a sweep must never fail
 *      live work;
 *   4. a queued row with no run id at all becomes `failed` with a reason once it is old enough to
 *      be hopeless, and is left alone while it is still young;
 *   5. a settled row is never touched again — running the sweep twice changes nothing;
 *   6. the sweep is actually wired into the routine-runner and ceo-rollups crons.
 *
 *   npm run verify:routine-reconcile
 */
import { readFileSync } from 'node:fs';
import {
  classifyRoutineRow,
  reconcileRoutineRuns,
  routineStatusFromRun,
  type HarnessRunOutcome,
  type RoutineRunRowForReconcile,
} from '../lib/agent/routines';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string | null = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

const NOW = new Date('2026-11-26T06:30:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MINUTE = 60_000;

/** The real provider failure this bug was found through. */
const CREDIT_ERROR =
  'Platform AI provider out of credit (not the customer\'s balance): Insufficient Balance';

const row = (over: Partial<RoutineRunRowForReconcile> & { id: string }): RoutineRunRowForReconcile => ({
  status: 'queued',
  run_id: null,
  created_at: ago(10 * MINUTE),
  ...over,
});

const run = (over: Partial<HarnessRunOutcome> & { id: string }): HarnessRunOutcome => ({
  status: 'completed',
  attempts: 1,
  error: null,
  updated_at: ago(MINUTE),
  ...over,
});

// ── 1. the status mapping itself ─────────────────────────────────────────────
head('1. A harness status maps to a routine status, and only terminal ones do');

check('completed → completed', routineStatusFromRun({ status: 'completed' }) === 'completed');
check('dead → failed', routineStatusFromRun({ status: 'dead' }) === 'failed');
check('failed → failed', routineStatusFromRun({ status: 'failed' }) === 'failed');
check('cancelled → failed (the owner stopped it; it will never produce the day)', routineStatusFromRun({ status: 'cancelled' }) === 'failed');
check('running → nothing yet', routineStatusFromRun({ status: 'running' }) === null);
check('queued → nothing yet', routineStatusFromRun({ status: 'queued' }) === null);
check('a missing run → nothing (never invent an outcome)', routineStatusFromRun(null) === null);

// ── 2. completed run settles the row ─────────────────────────────────────────
head('2. A completed run makes the row completed');

const completedRow = row({ id: 'rr-completed', run_id: 'hr-1' });
const completedDecision = classifyRoutineRow(completedRow, run({ id: 'hr-1', status: 'completed' }), NOW);
check('the row settles', completedDecision !== null, completedDecision?.why);
check('as completed', completedDecision?.status === 'completed', completedDecision?.status);
check('with no error written over it', completedDecision?.error === null, String(completedDecision?.error));

// ── 3. a dead run fails the row AND keeps the provider's words ───────────────
head('3. A dead run fails the row and carries the error');

const deadRow = row({ id: 'rr-dead', run_id: 'hr-2' });
const deadDecision = classifyRoutineRow(deadRow, run({ id: 'hr-2', status: 'dead', error: CREDIT_ERROR }), NOW);
check('the row settles', deadDecision !== null);
check('as failed', deadDecision?.status === 'failed', deadDecision?.status);
check(
  "the provider's own error is what the owner can read",
  typeof deadDecision?.error === 'string' && deadDecision.error.includes('Insufficient Balance'),
  deadDecision?.error,
);
check('and the reason names the run status', deadDecision?.why === 'run dead', deadDecision?.why);

const silentDead = classifyRoutineRow(row({ id: 'rr-dead-2', run_id: 'hr-3' }), run({ id: 'hr-3', status: 'dead', error: null }), NOW);
check(
  'a dead run with no error still says something useful',
  typeof silentDead?.error === 'string' && silentDead.error.includes('hr-3') && /no error/i.test(silentDead.error),
  silentDead?.error,
);

const longError = 'x'.repeat(2000);
const truncated = classifyRoutineRow(row({ id: 'rr-long', run_id: 'hr-4' }), run({ id: 'hr-4', status: 'failed', error: longError }), NOW);
check('a 2000-character error is truncated, not pasted into a column', (truncated?.error?.length ?? 0) === 400, `${truncated?.error?.length} chars`);

// ── 4. live runs are never touched ──────────────────────────────────────────
head('4. A run that is still going is left alone');

for (const status of ['running', 'queued', 'retrying']) {
  const live = classifyRoutineRow(row({ id: `rr-${status}`, run_id: 'hr-live' }), run({ id: 'hr-live', status }), NOW);
  check(`${status} run leaves the row queued`, live === null);
}
const unreadable = classifyRoutineRow(row({ id: 'rr-unreadable', run_id: 'hr-gone' }), null, NOW);
check('a harness row that could not be read is NOT a failure', unreadable === null);

const young = classifyRoutineRow(row({ id: 'rr-young', run_id: 'hr-young', created_at: ago(30_000) }), run({ id: 'hr-young', status: 'completed' }), NOW);
check('a row from 30 seconds ago is untouched even if its run says completed', young === null);

// ── 5. a row that can never progress is failed, by name ─────────────────────
head('5. A queued row with no run id cannot progress for ever');

const orphan = classifyRoutineRow(row({ id: 'rr-orphan', run_id: null, created_at: ago(45 * MINUTE) }), null, NOW);
check('45 minutes with no run id becomes failed', orphan?.status === 'failed', orphan?.status);
check('with a reason that says why', /no run id/i.test(orphan?.error || ''), orphan?.error);
check('and the age it waited', /45 minutes/.test(orphan?.error || ''), orphan?.error);

const youngOrphan = classifyRoutineRow(row({ id: 'rr-orphan-young', run_id: null, created_at: ago(5 * MINUTE) }), null, NOW);
check('5 minutes with no run id is still pending, not failed', youngOrphan === null);

// ── 6. settled rows are never rewritten (idempotency) ───────────────────────
head('6. Running the sweep twice changes nothing');

for (const settled of ['completed', 'failed']) {
  const again = classifyRoutineRow(row({ id: `rr-${settled}`, run_id: 'hr-1', status: settled }), run({ id: 'hr-1', status: 'dead', error: CREDIT_ERROR }), NOW);
  check(`a row already ${settled} is not touched even by a conflicting run`, again === null);
}

/**
 * The classifier is the whole of the sweep's decision-making, so proving idempotency on it is
 * proving it on the sweep: settle a batch, then ask again and require zero decisions.
 */
const batch: RoutineRunRowForReconcile[] = [
  row({ id: 'b-1', run_id: 'hr-c' }),
  row({ id: 'b-2', run_id: 'hr-d' }),
  row({ id: 'b-3', run_id: 'hr-live' }),
  row({ id: 'b-4', run_id: null, created_at: ago(40 * MINUTE) }),
];
const runs = new Map<string, HarnessRunOutcome>([
  ['hr-c', run({ id: 'hr-c', status: 'completed' })],
  ['hr-d', run({ id: 'hr-d', status: 'dead', error: CREDIT_ERROR })],
  ['hr-live', run({ id: 'hr-live', status: 'running' })],
]);

const settle = (rows: RoutineRunRowForReconcile[]) => {
  const decisions = rows
    .map((r) => classifyRoutineRow(r, r.run_id ? runs.get(r.run_id) : null, NOW))
    .filter((d): d is NonNullable<typeof d> => d !== null);
  const next = rows.map((r) => {
    const d = decisions.find((decision) => decision.id === r.id);
    return d ? { ...r, status: d.status } : r;
  });
  return { decisions, next };
};

const first = settle(batch);
check('first sweep settles the three that can be settled', first.decisions.length === 3, first.decisions.map((d) => `${d.id}:${d.status}`).join(', '));
check('and leaves the live one queued', first.next.find((r) => r.id === 'b-3')?.status === 'queued');
check('completed/failed/no-run-id are each settled truthfully', first.decisions.find((d) => d.id === 'b-1')?.status === 'completed' && first.decisions.find((d) => d.id === 'b-2')?.status === 'failed' && first.decisions.find((d) => d.id === 'b-4')?.status === 'failed');

const second = settle(first.next);
check('second sweep decides nothing at all', second.decisions.length === 0, second.decisions.map((d) => d.id).join(', '));
check('and the rows are byte-identical afterwards', JSON.stringify(second.next) === JSON.stringify(first.next));

// ── 7. the sweep is wired where the crons can reach it ──────────────────────
head('7. Both crons sweep, best-effort, and only touch queued rows');

const runnerRoute = readFileSync('app/api/cron/routine-runner/route.ts', 'utf8');
check(
  'the routine runner reconciles after dispatching',
  runnerRoute.indexOf('materialiseDueRoutines(') < runnerRoute.indexOf('reconcileRoutineRuns(') &&
    runnerRoute.includes('reconcileRoutineRuns('),
);
check('and a failed sweep does not fail the dispatch', /reconcileRoutineRuns\(supabase\)\.catch\(/.test(runnerRoute));

const rollupRoute = readFileSync('app/api/cron/ceo-rollups/route.ts', 'utf8');
check('ceo-rollups reconciles too', /reconcileRoutineRuns\(supabaseAdmin\)\.catch\(/.test(rollupRoute));
check(
  'before it counts anything, so the number it writes is fresh',
  rollupRoute.indexOf('reconcileRoutineRuns(') < rollupRoute.indexOf("from('routine_runs')"),
);

const libSource = readFileSync('lib/agent/routines.ts', 'utf8');
check(
  'the sweep only ever settles a row that still says queued',
  /\.eq\('status', 'queued'\)/.test(libSource) && /if \(String\(row\.status \|\| ''\) !== 'queued'\) return null;/.test(libSource),
);
check('and it is exported for the crons and for this gate', /export async function reconcileRoutineRuns\(/.test(libSource));
check('every settled row is stamped with updated_at', /update\(\{ status: decision\.status, error: decision\.error, updated_at: nowIso \}\)/.test(libSource));

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\nA routine row must say what happened to its run.');
  process.exit(1);
}
console.log('A settled routine row tells the truth, and a second sweep changes nothing.');
