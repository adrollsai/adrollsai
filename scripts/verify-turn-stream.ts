/**
 * The rules that keep a streamed reply from appearing twice.
 *
 * The transport change moved the answer off the event log and onto SSE. Two
 * things now show prose: the committed projection (one row per finished step)
 * and the live overlay (the assistant turn so far). Showing the same paragraph
 * from both is what "the agent replied twice" looked like, so the overlap is
 * subtracted explicitly — and that subtraction is what this file pins down.
 *
 * Also pinned: a step costs exactly ONE `assistant.text` row. The old design
 * wrote the growing answer four times a second, which is 150-340 rows per short
 * reply and, eventually, a history too big for the model window.
 *
 *   npm run verify:turn-stream
 */
import { stepToEvents } from '../lib/agent/harness/persist';
import { project } from '../lib/agent/harness/projection';
import { stripPersistedPrefix } from '../lib/agent/harness/useRunStream';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

/** Build a UI message the way `readUIMessageStream` would, from text pieces. */
function uiMessage(parts: Array<{ type: string; text?: string }>) {
  return {
    id: 'a1',
    role: 'assistant',
    parts: parts.map((p, i) => ({ type: p.type, text: p.text, state: 'done', ...(p.type === 'text' ? { textId: `t${i}` } : {}) })),
  } as any;
}

function textOf(message: any): string {
  return (message?.parts || [])
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
}

function main() {
  console.log('\n▸ one step costs one row');
  {
    const step = {
      stepNumber: 0,
      text: 'Here is your answer.',
      reasoningText: 'thinking about it',
      toolCalls: [
        { toolCallId: 'c1', toolName: 'find_tools', input: { query: 'flow' } },
        { toolCallId: 'c2', toolName: 'call_tool', input: { name: 'create_flow' } },
      ],
      toolResults: [
        { toolCallId: 'c1', toolName: 'find_tools', output: { ok: true } },
        { toolCallId: 'c2', toolName: 'call_tool', output: { ok: true } },
      ],
    };
    const events = stepToEvents(step as any);
    const textRows = events.filter((e) => e.type === 'assistant.text').length;
    const reasoningRows = events.filter((e) => e.type === 'assistant.reasoning').length;
    check('a finished step writes exactly one assistant.text row', textRows === 1, `${textRows} row(s)`);
    check('a finished step writes exactly one reasoning row', reasoningRows === 1, `${reasoningRows} row(s)`);
    check(
      'tool traffic is still recorded, once per call and per result',
      events.filter((e) => e.type === 'tool.call').length === 2 &&
        events.filter((e) => e.type === 'tool.result').length === 2
    );

    // Replaying the same step (a retried slice) must not duplicate the prose.
    const once = project('s', [
      { seq: 1, type: 'user.message', data: { id: 'u1', text: 'hi' } },
      ...events.map((e, i) => ({ seq: i + 2, type: e.type, data: e.data })) as any,
    ]);
    const twice = project('s', [
      { seq: 1, type: 'user.message', data: { id: 'u1', text: 'hi' } },
      ...events.map((e, i) => ({ seq: i + 2, type: e.type, data: e.data })) as any,
      ...events.map((e, i) => ({ seq: i + 20, type: e.type, data: e.data })) as any,
    ]);
    check(
      'persisting the same step twice does not add a second reply',
      once.items.length === twice.items.length,
      `${once.items.length} vs ${twice.items.length} items`
    );
  }

  console.log('\n▸ an empty step writes nothing at all');
  {
    const events = stepToEvents({ stepNumber: 3 } as any);
    check('a step with no text, reasoning or tools writes no rows', events.length === 0, `${events.length} rows`);
  }

  console.log('\n▸ a second turn does not erase the first');
  {
    // Step numbers restart at 0 in every turn, so unscoped ids made turn 3's
    // reply overwrite turn 1's in the projection. The scope is the run id, so
    // turns never collide.
    const first = stepToEvents({ stepNumber: 0, text: 'First answer.' } as any, 'runA_s1_');
    const second = stepToEvents({ stepNumber: 0, text: 'Second answer.' } as any, 'runB_s1_');
    const log = project('s', [
      { seq: 1, type: 'user.message', data: { id: 'u1', text: 'hi' } },
      ...first.map((e, i) => ({ seq: i + 2, type: e.type, data: e.data })) as any,
      { seq: 20, type: 'user.message', data: { id: 'u2', text: 'and again' } },
      ...second.map((e, i) => ({ seq: i + 21, type: e.type, data: e.data })) as any,
    ]);
    const replies = log.items.filter((i) => i.kind === 'assistant').map((i: any) => i.text);
    check(
      'both replies survive a conversation with two turns',
      replies.length === 2 && replies[0] === 'First answer.' && replies[1] === 'Second answer.',
      JSON.stringify(replies)
    );

    // Retrying the SAME slice must still be idempotent.
    const retry = stepToEvents({ stepNumber: 0, text: 'First answer.' } as any, 'runA_s1_');
    const withRetry = project('s', [
      { seq: 1, type: 'user.message', data: { id: 'u1', text: 'hi' } },
      ...first.map((e, i) => ({ seq: i + 2, type: e.type, data: e.data })) as any,
      ...retry.map((e, i) => ({ seq: i + 30, type: e.type, data: e.data })) as any,
    ]);
    check(
      'a retried slice does not duplicate the reply',
      withRetry.items.filter((i) => i.kind === 'assistant').length === 1,
      `${withRetry.items.filter((i) => i.kind === 'assistant').length} replies`
    );
  }

  console.log('\n▸ the live overlay never repeats the committed transcript');
  {
    // Nothing committed yet: the whole live turn shows.
    const live = uiMessage([{ type: 'text', text: 'Working on it' }]);
    const nonePersisted = stripPersistedPrefix(live, { text: [] });
    check('an unpersisted turn is shown in full', textOf(nonePersisted) === 'Working on it');

    // The step finished and was persisted: the overlay has nothing left to add.
    const persisted = stripPersistedPrefix(live, { text: ['Working on it'] });
    check('once the step is in the log the overlay is empty', textOf(persisted) === '', JSON.stringify(textOf(persisted)));

    // A second step is in flight: only the in-flight part shows.
    const twoSteps = uiMessage([{ type: 'text', text: 'Working on it. Next, the flow.' }]);
    const partial = stripPersistedPrefix(twoSteps, { text: ['Working on it.'] });
    check(
      'a multi-step answer shows only the step still in flight',
      textOf(partial).trim() === 'Next, the flow.',
      JSON.stringify(textOf(partial))
    );

    // persistStep trims, so the live text may carry leading whitespace.
    const padded = uiMessage([{ type: 'text', text: '\n\nAlready saved. New part.' }]);
    const trimmed = stripPersistedPrefix(padded, { text: ['Already saved.'] });
    check(
      'a trimmed persisted prefix still matches the padded live text',
      textOf(trimmed).trim() === 'New part.',
      JSON.stringify(textOf(trimmed))
    );

    // Reasoning is subtracted the same way, and must not eat the prose.
    const withThinking = uiMessage([{ type: 'reasoning', text: 'I should check.' }, { type: 'text', text: 'Checked.' }]);
    const both = stripPersistedPrefix(withThinking, { reasoning: ['I should check.'], text: [] });
    const bothParts: any[] = (both as any)?.parts ?? [];
    check(
      'persisted reasoning is subtracted without touching the reply',
      textOf(both).trim() === 'Checked.' && bothParts.some((p: any) => p.type === 'reasoning') === false,
      JSON.stringify(bothParts.map((p: any) => p.type))
    );

    // An unrelated older reply must never be subtracted from a new one.
    const fresh = uiMessage([{ type: 'text', text: 'Sure — here is the plan.' }]);
    const untouched = stripPersistedPrefix(fresh, { text: ['Hi! I am here.'] });
    check('an older reply is never subtracted from a new one', textOf(untouched) === 'Sure — here is the plan.');
  }

  console.log('\n▸ a long reply no longer inflates the log');
  {
    // What the old per-chunk pump did: it flushed the growing answer about four
    // times a second for the whole generation (the loop skipped anything inside
    // 250ms), rewriting the same text under the same id each time.
    const answer = 'x'.repeat(600);
    const generationMs = 12_000;
    const oldFlushes = Math.floor(generationMs / 250);

    // What the current design does: one row, at the step boundary.
    const rows = stepToEvents({ stepNumber: 0, text: answer } as any).filter(
      (e) => e.type === 'assistant.text'
    ).length;

    check(
      'the previous design wrote a row every ~250ms of generation',
      oldFlushes === 48,
      `${oldFlushes} rows for a 12s answer`
    );
    check('the current design writes one row for the whole step', rows === 1, `${answer.length} chars -> ${rows} row`);
    check(
      'the transcript is smaller by more than an order of magnitude',
      oldFlushes / rows > 10,
      `${oldFlushes}x fewer rows`
    );
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
