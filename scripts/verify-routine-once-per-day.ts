/**
 * Proves a business cannot be charged twice for the same day's routine, and that a run with no
 * instruction is refused at the door instead of dead-lettered in the worker.
 *
 * WHY THIS GATE EXISTS
 * Two separate bugs combined to make duplicate work invisible:
 *
 *   1. Nothing stopped a business holding several `business_routines` rows, and the routine-run
 *      idempotency key is `(routine_id, period_key)` — per routine, not per business. So every
 *      extra row bought another run for the same day with its own key. Measured: six runs for one
 *      tenant on 2026-11-12.
 *   2. A run could be queued with no instruction at all, which the worker dead-lettered silently
 *      30 seconds later in another process — `attempts: 0`, nothing thrown, nobody told.
 *
 * The fixes are a pure picker, a pure validator, three call-site guards and two database
 * constraints. This gate pins the pure halves and the guards; the constraints are proven by
 * `scratch/prove-routine-constraints.mjs` against the live database.
 *
 *   npm run verify:routine-once-per-day
 */
import { readFileSync } from 'node:fs';
import { pickRoutinesToMaterialise } from '../lib/agent/routines';
import { runInstructionProblem } from '../lib/agent/harness/runs';
import { DETECTORS } from '../lib/ops/detectors';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

const routine = (user: string, id: string) => ({ user_id: user, id });

head('1. One run per business, whatever the table holds');

const one = pickRoutinesToMaterialise([routine('u1', 'r1')]);
check('a single routine passes through', one.length === 1 && one[0].id === 'r1');

const dupes = pickRoutinesToMaterialise([
  routine('u1', 'r-overdue'),
  routine('u1', 'r-second'),
  routine('u1', 'r-third'),
]);
check('three rows for one business collapse to one', dupes.length === 1, `${dupes.length} kept`);
check(
  'the row kept is the first offered, which the caller ordered by next_run_at — the most overdue',
  dupes[0]?.id === 'r-overdue',
  dupes[0]?.id,
);

const mixed = pickRoutinesToMaterialise([
  routine('u1', 'r1'),
  routine('u2', 'r2'),
  routine('u1', 'r3'),
  routine('u2', 'r4'),
]);
check('several businesses each keep exactly one', mixed.length === 2, mixed.map((r) => r.id).join(', '));
check('order is preserved across businesses', mixed[0].id === 'r1' && mixed[1].id === 'r2');

check('an empty list stays empty', pickRoutinesToMaterialise([]).length === 0);
check(
  'a row with no user cannot claim a slot for anyone',
  pickRoutinesToMaterialise([{ user_id: '', id: 'bad' }, routine('u1', 'r1')]).length === 1,
);

head('2. A run with no instruction is refused at the door');

const refusals: [string, string | null | undefined][] = [
  ['null', null],
  ['undefined', undefined],
  ['an empty string', ''],
  ['whitespace only', ' \n\t '],
];
for (const [label, value] of refusals) {
  const problem = runInstructionProblem(value);
  check(`refuses ${label}`, typeof problem === 'string' && problem.length > 20, problem?.slice(0, 48));
}
check('accepts a real instruction', runInstructionProblem('Make the Diwali post') === null);
check('accepts one padded with whitespace', runInstructionProblem('  Make the Diwali post \n') === null);

head('3. The guards are actually wired in');

const enqueueSource = readFileSync('lib/agent/harness/runs.ts', 'utf8');
check(
  'enqueueRun throws on an unrunnable run instead of returning null',
  /runInstructionProblem\(input\.goal\)/.test(enqueueSource) && /throw new Error\(`enqueueRun: \$\{problem\}`\)/.test(enqueueSource),
);
check(
  'and it says so in the log, naming the session',
  /refusing to enqueue an unrunnable run/.test(enqueueSource),
);

const routeSource = readFileSync('app/api/agent/v2/runs/route.ts', 'utf8');
check(
  'the runs route rejects a request with no instruction as a 400, not a 500',
  /runInstructionProblem\(goal\)/.test(routeSource) && /status: 400/.test(routeSource),
);

const routinesSource = readFileSync('lib/agent/routines.ts', 'utf8');
check(
  'the materialiser queues at most one run per business',
  /for \(const routine of due\)/.test(routinesSource) && /pickRoutinesToMaterialise\(routines/.test(routinesSource),
);
check(
  'and it logs the duplicates it ignored rather than discarding them silently',
  /duplicate routine row\(s\) ignored/.test(routinesSource),
);

head('4. The database refuses the duplicates that caused this');

const sqlFile = readFileSync('sql/ops-robustness-routine-uniqueness.sql', 'utf8');
check(
  'one enabled routine per business is a unique index',
  /create unique index if not exists business_routines_one_enabled_per_user[\s\S]{0,120}where enabled/.test(sqlFile),
);
check(
  'one claim per business per period is a unique constraint',
  /routine_runs_tenant_period_unique unique \(user_id, period_key\)/.test(sqlFile),
);
check(
  'the SQL is re-runnable, so a deploy cannot fail on a second application',
  /if not exists/.test(sqlFile) && /if not exists \(/.test(sqlFile),
);

head('5. The watchdog watches this, not just the two bugs');

check(
  'a duplicate-routine detector is registered',
  DETECTORS.some((detector) => detector.id === 'routine-duplicate-rows'),
  `${DETECTORS.length} detectors`,
);
check(
  "and it reports rather than deletes a customer's configuration",
  (DETECTORS.find((detector) => detector.id === 'routine-duplicate-rows')?.watches.length ?? 0) > 20,
  'the detector only ever reports; removing a routine is a decision',
);

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\nA business must not be able to run the same day twice, and a run must not be');
  console.error('queued with nothing to do.');
  process.exit(1);
}
console.log('One instruction per run, one run per business per period.');
