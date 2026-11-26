/**
 * GATE: a message typed while the agent is working must appear in the chat, and must not be reported
 * as delivered unless it was.
 *
 * WHY THIS GATE EXISTS
 * The owner reported: "when we send a followup message while the agent is running in the chat, the
 * message just disappears, seems like we didn't send anything, but it says that that message will be
 * considered before next step of the agent — at least show that message in the chat."
 *
 * The message was never lost. Verified against production `harness_events`: a `user.message` written
 * mid-run at seq 46 of one session (`what is going on and what is the eta?`, between a tool result and
 * the next `run.status`) and at seq 254 of another, and folding those logs puts both in the projection.
 * It was hidden, by two separate mechanisms:
 *
 *   1. THE TRANSCRIPT COLLAPSED IT. Consecutive identical items were collapsed for both roles, which is
 *      right for an assistant reply written twice (once by the stream, once by the run) and wrong for a
 *      user message. Two identical questions are two acts. Production holds the evidence for exactly
 *      that shape: session 65a444aa has "how many credits got consumed for this task" at seq 264 AND at
 *      seq 275, both in the projection, one rendered.
 *   2. THE SEND WAS FIRE-AND-FORGET. `void appendUserMessage(...)` was followed immediately by
 *      `toast.success('Delivered to the running task')`, so a failed write still produced a delivery
 *      message — and the next projection refresh then deleted the optimistic row, leaving the owner
 *      with a claim that something had been delivered and no message. A refresh landing while the write
 *      was in flight did the same thing even when the write succeeded.
 *
 * The rules this gate pins:
 *   - a user message is never collapsed, however often it repeats; a repeated ASSISTANT reply is;
 *   - an empty block is not content (an attachment-only message still is);
 *   - a message the snapshot has not seen yet survives a projection refresh, and is not duplicated once
 *     the snapshot has it;
 *   - delivery is claimed only after the write returns an id, and the text goes back in the box when it
 *     does not.
 *
 * Pure: no browser, no network, no model.
 *
 *   npm run verify:chat-steering
 */
import { readFileSync } from 'node:fs';
import { visibleTranscriptItems } from '../lib/agent/harness/transcript-filter';
import { initialState, keepUncommittedUserItems, type HarnessState } from '../lib/agent/harness/projection';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string | number | null = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail !== '' && detail !== null ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail !== '' && detail !== null ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

const user = (id: string, text: string, attachments?: unknown[]) =>
  ({ kind: 'user', id, text, attachments } as any);
const assistant = (id: string, text: string) => ({ kind: 'assistant', id, text } as any);

// ── 1. a user message is never collapsed ────────────────────────────────────
head('1. Two identical questions are two questions');

{
  const items = [
    user('u1', 'what is the update?'),
    user('u2', 'what is the update?'),
  ];
  const out = visibleTranscriptItems(items);
  check('both identical user messages survive', out.length === 2, out.length);
  check('and they are distinct ids, in order', out.map((i) => i.id).join(',') === 'u1,u2', out.map((i) => i.id).join(','));

  // The exact shape found in production: seq 264 and seq 275, same text, mid-run.
  const production = [
    user('u_a', 'how many credits got consumed for this task'),
    { kind: 'tool', id: 't1', name: 'query_account_data', status: 'ok' } as any,
    user('u_b', 'how many credits got consumed for this task'),
  ];
  check('the production duplicate renders twice', visibleTranscriptItems(production).filter((i) => i.kind === 'user').length === 2);

  const steer = [
    user('u1', 'draft the poster'),
    assistant('a1', 'Working on it.'),
    user('u2', 'no, make it for the Dubai project instead'),
    assistant('a2', 'Switching to the Dubai project.'),
  ];
  const kept = visibleTranscriptItems(steer);
  check('a steering message between two replies is kept, in place', kept.length === 4, kept.length);
  check('and it sits after the reply it interrupts', kept[2].id === 'u2', kept[2].id);
}

// ── 2. an assistant reply written twice is still collapsed ──────────────────
head('2. A repeated ASSISTANT reply is still collapsed (that is what the rule was for)');

{
  const items = [assistant('a1', 'Here is the plan.'), assistant('a2', 'Here is the plan.')];
  check('identical consecutive replies collapse to one', visibleTranscriptItems(items).length === 1);

  const trailing = [assistant('a1', 'Here is the plan.\n'), assistant('a2', 'Here is the plan. ')];
  check('whitespace differences do not defeat the collapse', visibleTranscriptItems(trailing).length === 1);

  const different = [assistant('a1', 'First.'), assistant('a2', 'Second.')];
  check('different replies are both kept', visibleTranscriptItems(different).length === 2);

  const aroundUser = [assistant('a1', 'Same.'), user('u1', 'ok'), assistant('a2', 'Same.')];
  check('a reply repeated either side of a user message is NOT collapsed', visibleTranscriptItems(aroundUser).length === 3);
}

// ── 3. empty blocks ─────────────────────────────────────────────────────────
head('3. An empty block is not content; an attachment is');

{
  check('an empty assistant block is dropped', visibleTranscriptItems([assistant('a1', '   ')]).length === 0);
  check('an empty user block with no attachment is dropped', visibleTranscriptItems([user('u1', '  ')]).length === 0);
  check(
    'a user message with only an attachment is kept',
    visibleTranscriptItems([user('u1', '', [{ name: 'plan.pdf', type: 'application/pdf' }])]).length === 1,
  );
  check('tools and reasoning are never filtered', visibleTranscriptItems([
    { kind: 'tool', id: 't', name: 'x', status: 'ok' } as any,
    { kind: 'reasoning', id: 'r', text: 'thinking' } as any,
  ]).length === 2);
}

// ── 4. a refresh must not delete what the owner just sent ───────────────────
head('4. A projection refresh keeps an unsent message and never duplicates a sent one');

{
  const server = initialState('s1');
  const local: HarnessState = {
    ...server,
    items: [...server.items, user('u_new', 'and the eta?')],
    seenIds: { ...server.seenIds, u_new: true },
    version: server.version + 1,
  };

  const merged = keepUncommittedUserItems(local, server);
  check('the pending message survives a stale snapshot', (merged?.items || []).some((i) => i.id === 'u_new'), (merged?.items || []).length);
  check('and is not marked as nothing-happened', merged?.seenIds?.u_new === true);

  // Once the snapshot contains it, the merge must not add it a second time.
  const committed: HarnessState = {
    ...server,
    items: [...server.items, user('u_new', 'and the eta?')],
    seenIds: { ...server.seenIds, u_new: true },
    version: server.version + 1,
  };
  const afterCommit = keepUncommittedUserItems(local, committed);
  check(
    'a committed message is not duplicated by the merge',
    (afterCommit?.items || []).filter((i) => i.id === 'u_new').length === 1,
    (afterCommit?.items || []).filter((i) => i.id === 'u_new').length,
  );

  const otherSession = { ...server, sessionId: 's2' };
  check(
    'a different session is never merged into this one',
    keepUncommittedUserItems(local, otherSession)?.items.length === 0,
  );
  check('no previous state means the server wins outright', keepUncommittedUserItems(null, server) === server);
  check('no server state means nothing to merge into', keepUncommittedUserItems(local, null) === null);

  const withAssistantLocal: HarnessState = {
    ...local,
    items: [...local.items, assistant('a_local', 'half-streamed reply')],
  };
  const mergeAssistant = keepUncommittedUserItems(withAssistantLocal, server);
  check(
    'only user items are carried over — an assistant block is rebuilt from the projection',
    !(mergeAssistant?.items || []).some((i) => i.id === 'a_local'),
    (mergeAssistant?.items || []).map((i) => i.id).join(','),
  );
}

// ── 5. delivery is claimed only when it happened ─────────────────────────────
head('5. The chat claims delivery only after the write lands');

{
  const chat = readFileSync('components/agent/AgentChat.tsx', 'utf8');
  const hook = readFileSync('lib/agent/harness/useHarnessSession.ts', 'utf8');

  check(
    'the steering send is awaited, not fired and forgotten',
    !/[^`]void harness\.appendUserMessage\(/.test(chat) && /const appended = await harness\.appendUserMessage\(/.test(chat),
  );
  check(
    'the success toast happens only when the append returned an id',
    /if \(!appended\) \{/.test(chat) && chat.indexOf('if (!appended) {') < chat.indexOf('Delivered to the running task'),
    `${chat.indexOf('if (!appended) {')} < ${chat.indexOf('Delivered to the running task')}`,
  );
  check('a failed send says so instead of claiming success', /That message did not reach the running task/.test(chat));
  check('and puts the text back in the composer', /setInput\(\(current\) => \(current \? current : fullPrompt\)\)/.test(chat));

  check(
    'the append removes its optimistic row when the write fails',
    /items: prev\.items\.filter\(\(item\) => item\.id !== id\)/.test(hook),
  );
  check('and returns null so the caller can react', /setError\(err\?\.message \|\| 'Could not save your message to the log'\);\s*return null;\s*\}\s*return id;/.test(hook));
  check('the projection refresh keeps an uncommitted user message', /keepUncommittedUserItems\(prev, next\)/.test(hook));
  check('and so does opening a session', /keepUncommittedUserItems\(prev, nextState\)/.test(hook));

  const transcript = readFileSync('components/agent/HarnessTranscript.tsx', 'utf8');
  check('the transcript uses the tested filter', /visibleTranscriptItems\(items\)/.test(transcript));
  check(
    'and no longer collapses by text inline',
    !/prevText !== ownText/.test(transcript),
  );
}

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\nA message the owner typed must be visible, and delivery must not be claimed in advance.');
  process.exit(1);
}
console.log('A steering message now shows up in the chat, and "delivered" means delivered.');
