/**
 * Proves a goal-only run can start, and that the seed never puts words in the owner's mouth.
 *
 * WHY THIS GATE EXISTS
 * The bug it guards was invisible for eleven days: routines and WhatsApp approvals queued runs
 * whose instruction lived only in `run.goal`, the runner rebuilt the conversation from a log
 * containing nothing but `run.status` bookkeeping, found zero messages, and dead-lettered the
 * run with `attempts: 0`. Nothing threw, nothing alerted, and the tenant's daily marketing
 * simply never happened. A fix for that cannot be left to inspection.
 *
 * The failure modes worth pinning:
 *   - a goal-bearing run does not get seeded (the original bug)
 *   - a seed is written in a shape the event log cannot replay (silent on resume)
 *   - a run that ALREADY has a conversation gets a fabricated user turn appended, which would
 *     corrupt a real transcript and duplicate what the owner actually said
 *   - a run with no goal gets seeded with an empty turn, which the model would read as the
 *     owner saying nothing and then act on
 *
 *   npm run verify:runner-goal-seed
 */
import { readFileSync } from 'node:fs';
import { goalSeedFor } from '../lib/agent/harness/runner';
import { parseEvent } from '../lib/agent/harness/events';

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

const RUN_ID = 'd7ada95d-65cf-4ad2-b0d1-7782c87fd187';
const BRIEF =
  'You are running marketing for Mohit today (2026-11-23, Asia/Kolkata).\n' +
  'Industry: neutral. Talk about "offerings", and use "Chat with us on WhatsApp" language.';

head('1. A goal-bearing run gets an opening turn');

const seed = goalSeedFor(BRIEF, RUN_ID);
check('a run with a goal is seeded', seed !== null);
check('the seeded turn is a user message', seed?.event.type === 'user.message', seed?.event.type);
check('the goal is the message text, unchanged', seed?.message.content === BRIEF, `${BRIEF.length} chars`);
check(
  'the model-facing message is the shape the runner passes to generateText',
  seed?.message.role === 'user' && typeof seed?.message.content === 'string',
  `role=${seed?.message.role}`,
);
check(
  'the event id is derived from the run, so a retried slice writes the same turn',
  seed?.event.data.id === `run-goal-${RUN_ID}`,
  String(seed?.event.data.id),
);

head('2. The seed can be replayed from the log');

// The log is read back through `parseEvent`, which validates the payload against the schema.
// A seed that only works in memory would start this slice and then lose the turn on resume.
const replayed = parseEvent({ seq: 1, type: seed?.event.type, data: seed?.event.data });
check('a persisted seed parses back into a harness event', replayed !== null);
check(
  'and it survives the round trip with its text intact',
  (replayed?.data as { text?: string })?.text === BRIEF,
);
check(
  'the seeded id round trips too',
  (replayed?.data as { id?: string })?.id === `run-goal-${RUN_ID}`,
);

head('3. It refuses to invent a turn');

const refusals: [string, string | null | undefined][] = [
  ['no goal at all', null],
  ['undefined', undefined],
  ['an empty string', ''],
  ['whitespace only', '   \n\t  '],
];
for (const [label, value] of refusals) {
  check(`refuses to seed ${label}`, goalSeedFor(value, RUN_ID) === null);
}

head('4. Whitespace from a template is not part of the task');

const padded = goalSeedFor(`\n\n   ${BRIEF}   \n`, RUN_ID);
check('the seeded text is trimmed', padded?.message.content === BRIEF, `${padded?.message.content?.length} chars`);
check('and the log entry matches the message', padded?.event.data.text === padded?.message.content);

head('5. The caller guards the conversation it already has');

// `goalSeedFor` cannot see the conversation, so the runner must only ask for a seed when the
// reconstruction produced nothing. Asserting on the source keeps that ordering requirement
// visible: it is the difference between seeding a missing turn and overwriting a real one.
const runnerSource = readFileSync('lib/agent/harness/runner.ts', 'utf8');
check(
  'the runner only seeds when the reconstructed conversation is empty',
  /messages\.length\s*\?\s*null\s*:\s*goalSeedFor\(/.test(runnerSource),
  'guard: messages.length ? null : goalSeedFor(...)',
);
check(
  'the seed is written to the event log, not only held in memory',
  /appendEvent\(supabase,\s*run\.session_id,\s*seed\.event\.type/.test(runnerSource),
);
check(
  'the seeded sequence is claimed so the post-slice read cannot echo it back',
  /loadedMaxSeq\s*\+=\s*1/.test(runnerSource),
);

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\nA goal-only run must start, and must never be handed a fabricated turn.');
  process.exit(1);
}
console.log('A run queued with a goal starts from that goal, recorded in the log.');
