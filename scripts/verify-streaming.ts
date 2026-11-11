/**
 * Verifies streaming partial text reaches the transcript.
 *
 * The felt difference from a live-streaming harness was mechanical: the durable
 * runner used generateText and only persisted at step boundaries, so the UI sat
 * silent for seconds and then jumped a whole step. Now the runner writes partial
 * `assistant.text` under one id as the answer grows, and the projection upserts
 * that row.
 *
 *   npm run verify:streaming
 */
import { project, applyEvent, initialState } from '../lib/agent/harness/projection';
import { createEvent } from '../lib/agent/harness/events';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const assistantTexts = (state: any) =>
  state.items.filter((i: any) => i.kind === 'assistant').map((i: any) => i.text);

const ev = (text: string, id = 'run1_p1_0') => createEvent('assistant.text', { id, text });

// Simulate the runner flushing partials as the answer grows.
const partials = ['Hello', 'Hello, thanks', 'Hello, thanks for reaching'];
let state = project('s1', [createEvent('session.opened', { title: 't', workspaceId: 'ws' })]);
const versions: number[] = [];
for (const p of partials) {
  state = applyEvent(state, ev(p));
  versions.push(state.version);
}

check('partials do not duplicate the message', assistantTexts(state).length === 1, `${assistantTexts(state).length} rows`);
check('final text is the complete answer', assistantTexts(state)[0] === 'Hello, thanks for reaching', assistantTexts(state)[0]);
check('each flush advanced the version (so the UI re-renders)', versions[0] < versions[1] && versions[1] < versions[2], versions.join(' -> '));

// Idempotency must survive: replaying the same log yields the same state.
const log = partials.map((p) => ev(p));
const replay = project('s1', log.map((e, i) => ({ ...e, seq: i + 1 })) as any);
check('replaying the same events is idempotent', assistantTexts(replay)[0] === 'Hello, thanks for reaching', assistantTexts(replay)[0]);
check('and does not create duplicates on replay', assistantTexts(replay).length === 1);

// A different id (next step) is a separate message, not an overwrite.
const twoSteps = project('s1', [ev('first answer', 'run1_p1_0'), ev('second answer', 'run1_p1_1')].map((e, i) => ({ ...e, seq: i + 1 })) as any);
check('a new step id is a new message', assistantTexts(twoSteps).length === 2, assistantTexts(twoSteps).join(' | '));

// Rewriting identical text must not churn the version (prevents needless renders).
const settled = project('s1', [ev('same', 'x1')].map((e, i) => ({ ...e, seq: i + 1 })) as any);
const before = settled.version;
const again = applyEvent(settled, ev('same', 'x1'));
check('writing identical text is a no-op', again.version === before, `${before} -> ${again.version}`);

console.log(`\n=== ${fails === 0 ? 'all checks passed' : fails + ' FAILED'}`);
if (fails) process.exit(1);
