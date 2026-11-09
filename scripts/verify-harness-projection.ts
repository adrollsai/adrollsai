/**
 * Verification for the harness projections.
 *
 * Run:  npx esbuild scripts/verify-harness-projection.ts --bundle --platform=node \
 *         --format=esm --outfile=.tmp-verify.mjs && node .tmp-verify.mjs
 *
 * Exit code 0 = all assertions passed. This exists because the projection is
 * the load-bearing part of the harness: if a fold is wrong, every session
 * replayed from the log renders wrong, and no amount of UI work can fix it.
 */
import { project, applyEvent, initialState, deriveTitle, toTranscript, itemsToUIMessages } from '../lib/agent/harness/projection';
import { stepToEvents } from '../lib/agent/harness/persist';
import {
  extractAttachments,
  extractImageAttachments,
  extractVideoAttachments,
} from '../lib/agent/harness/attachments';
import type { HarnessEvent } from '../lib/agent/harness/events';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  checks++;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

const ev = (seq: number, type: HarnessEvent['type'], data: Record<string, unknown>): HarnessEvent => ({
  seq,
  type,
  data,
});

console.log('\n▸ session metadata');
{
  const s = project('s1', [
    ev(1, 'session.opened', { title: 'New session', workspaceId: 'ws_a' }),
    ev(2, 'session.titled', { title: 'Diwali reel' }),
  ]);
  check('workspace applied', s.workspaceId === 'ws_a', s.workspaceId);
  check('title applied', s.title === 'Diwali reel', s.title);
}

console.log('\n▸ user + assistant messages');
{
  const s = project('s2', [
    ev(1, 'user.message', { id: 'u1', text: 'Make a 15s vertical video' }),
    ev(2, 'assistant.reasoning', { id: 'r1', text: 'Plan the storyboard' }),
    ev(3, 'assistant.text', { id: 'a1', text: 'Here is the render.' }),
  ]);
  check('three items', s.items.length === 3, s.items.map((i) => i.kind));
  check('order preserved', s.items.map((i) => i.kind).join(',') === 'user,reasoning,assistant');
  check('user text', s.items[0].kind === 'user' && s.items[0].text === 'Make a 15s vertical video');
}

console.log('\n▸ tool lifecycle updates its own row in place');
{
  const s = project('s3', [
    ev(1, 'tool.call', { callId: 'c1', name: 'sandbox_bash_run', input: { command: 'ls' } }),
    ev(2, 'tool.result', { callId: 'c1', output: { exitCode: 0 } }),
  ]);
  check('one tool row, not two', s.items.length === 1, s.items.length);
  const row = s.items[0];
  check('status done', row.kind === 'tool' && row.status === 'done', row);
  check('output attached', row.kind === 'tool' && JSON.stringify(row.output) === '{"exitCode":0}');
  check('toolIndex points at it', s.toolIndex['c1'] === 0, s.toolIndex);
}

console.log('\n▸ failed tool');
{
  const s = project('s4', [
    ev(1, 'tool.call', { callId: 'c1', name: 'sandbox_render_hyperframes' }),
    ev(2, 'tool.result', { callId: 'c1', isError: true, output: { error: 'ffmpeg missing' } }),
  ]);
  const row = s.items[0];
  check('status failed', row.kind === 'tool' && row.status === 'failed', row);
}

console.log('\n▸ out-of-order log is sorted by seq');
{
  const s = project('s5', [
    ev(3, 'assistant.text', { id: 'a1', text: 'third' }),
    ev(1, 'user.message', { id: 'u1', text: 'first' }),
    ev(2, 'assistant.reasoning', { id: 'r1', text: 'second' }),
  ]);
  check(
    'renders in seq order',
    s.items.map((i) => i.kind).join(',') === 'user,reasoning,assistant',
    s.items.map((i) => i.kind)
  );
}

console.log('\n▸ replay is idempotent');
{
  const log: HarnessEvent[] = [
    ev(1, 'user.message', { id: 'u1', text: 'hi' }),
    ev(2, 'tool.call', { callId: 'c1', name: 'sandbox_bash_run' }),
    ev(3, 'tool.call', { callId: 'c1', name: 'sandbox_bash_run' }),
    ev(4, 'tool.result', { callId: 'c1', output: {} }),
  ];
  const s = project('s6', log);
  check('duplicate tool.call does not duplicate the row', s.items.length === 2, s.items.length);
  const twice = project('s6', [...log, ...log]);
  check('folding the log twice equals folding once', twice.items.length === s.items.length, {
    once: s.items.length,
    twice: twice.items.length,
  });
}

console.log('\n▸ empty / invalid payloads are ignored, not crashed on');
{
  const s = project('s7', [
    ev(1, 'assistant.reasoning', { id: 'r1', text: '   ' }),
    ev(2, 'assistant.text', { id: 'a1', text: '' }),
    ev(3, 'tool.result', { callId: 'nope' }),
    ev(4, 'assistant.text', { id: 'a2', text: 'real' }),
  ]);
  check('only the real text landed', s.items.length === 1, s.items.length);
  check('live row is the assistant', s.items[0].kind === 'assistant');
}

console.log('\n▸ uninterested events return the SAME reference');
{
  const before = initialState('s8');
  const after = applyEvent(before, ev(1, 'session.status', { status: 'idle' }));
  check('same reference (framework can skip work)', after === before);
  const changed = applyEvent(before, ev(2, 'session.status', { status: 'running' }));
  check('real change produces a new reference', changed !== before);
  check('status applied', changed.status === 'running');
}

console.log('\n▸ turn error surfaces and flips status');
{
  const s = project('s9', [
    ev(1, 'user.message', { id: 'u1', text: 'go' }),
    ev(2, 'turn.error', { message: 'DeepSeek returned 402' }),
  ]);
  check('status error', s.status === 'error', s.status);
  check('error item present', s.items.some((i) => i.kind === 'error' && i.message.includes('402')));
}

console.log('\n▸ derived views');
{
  const s = project('s10', [
    ev(1, 'user.message', { id: 'u1', text: '  Render   a diwali   reel for Bioque Estates  ' }),
    ev(2, 'assistant.text', { id: 'a1', text: 'Done.' }),
  ]);
  const title = deriveTitle(s);
  check('title derived and whitespace-collapsed', title === 'Render a diwali reel for Bioque Estates', title);
  check('title is capped', deriveTitle(s, 10).length <= 10, deriveTitle(s, 10));
  const t = toTranscript(s);
  check('transcript has both turns', t.includes('User:') && t.includes('Assistant:'), t);
}

console.log('\n▸ step → events mapping (what the chat route writes)');
{
  const events = stepToEvents({
    stepNumber: 0,
    reasoningText: 'Plan the render',
    toolCalls: [{ toolCallId: 'c1', toolName: 'sandbox_bash_run', input: { command: 'ls' } }],
    toolResults: [{ toolCallId: 'c1', toolName: 'sandbox_bash_run', output: { success: true, stdout: 'ok' } }],
    text: 'Done.',
  });
  check('four events emitted', events.length === 4, events.map((e) => e.type));
  check(
    'ordered reasoning → call → result → text',
    events.map((e) => e.type).join(',') === 'assistant.reasoning,tool.call,tool.result,assistant.text',
    events.map((e) => e.type)
  );

  const folded = project(
    's11',
    events.map((e, i) => ({ seq: i + 1, type: e.type, data: e.data }))
  );
  check(
    'folding the mapped events reproduces the step',
    folded.items.map((i) => i.kind).join(',') === 'reasoning,tool,assistant',
    folded.items.map((i) => i.kind)
  );
  const toolRow = folded.items[1];
  check('tool row resolved to done', toolRow.kind === 'tool' && toolRow.status === 'done');

  // An empty step must produce nothing, not empty rows.
  check('empty step emits nothing', stepToEvents({ stepNumber: 1 }).length === 0);

  // A failed tool result is marked failed, not done.
  const failed = stepToEvents({
    stepNumber: 2,
    toolCalls: [{ toolCallId: 'c2', toolName: 'sandbox_render_hyperframes' }],
    toolResults: [{ toolCallId: 'c2', output: { success: false, error: 'ffmpeg missing' } }],
  });
  const failedFolded = project(
    's12',
    failed.map((e, i) => ({ seq: i + 1, type: e.type, data: e.data }))
  );
  const failedRow = failedFolded.items[0];
  check('failed tool marked failed', failedRow.kind === 'tool' && failedRow.status === 'failed', failedRow);
}

console.log('\n▸ reopening a session rebuilds model context');
{
  const s = project('s13', [
    ev(1, 'user.message', { id: 'u1', text: 'first question' }),
    ev(2, 'assistant.reasoning', { id: 'r1', text: 'thinking' }),
    ev(3, 'tool.call', { callId: 'c1', name: 'sandbox_bash_run' }),
    ev(4, 'tool.result', { callId: 'c1', output: { success: true } }),
    ev(5, 'assistant.text', { id: 'a1', text: 'first answer' }),
    ev(6, 'user.message', { id: 'u2', text: 'second question' }),
    ev(7, 'assistant.text', { id: 'a2', text: 'second answer' }),
  ]);
  const msgs = itemsToUIMessages(s.items);
  check('reasoning and tool traffic excluded', msgs.length === 4, msgs.length);
  check(
    'alternating user/assistant preserved',
    msgs.map((m) => m.role).join(',') === 'user,assistant,user,assistant',
    msgs.map((m) => m.role)
  );
  check('text carried through', msgs[1].parts[0].text === 'first answer', msgs[1]);

  // Consecutive same-role items must merge — some providers reject them.
  const merged = itemsToUIMessages(
    project('s14', [
      ev(1, 'assistant.text', { id: 'a1', text: 'part one' }),
      ev(2, 'assistant.text', { id: 'a2', text: 'part two' }),
    ]).items
  );
  check('consecutive assistant turns merged', merged.length === 1, merged.length);
  check('merged text keeps both', merged[0].parts[0].text.includes('part one') && merged[0].parts[0].text.includes('part two'));
}

console.log('\n▸ attachment parsing (images reach the vision model)');
{
  const imageMsg =
    '[Attached File: kitchen.png (image)]\nURL: https://cdn.example.test/a/kitchen.png\n\nInstruction: restyle this';
  const videoMsg =
    '[Attached File: ref.mp4 (video)]\nURL: https://cdn.example.test/a/ref.mp4\n\nInstruction: match this edit';

  const imgs = extractImageAttachments(imageMsg);
  check('image attachment found', imgs.length === 1, imgs);
  check('image url extracted', imgs[0]?.url === 'https://cdn.example.test/a/kitchen.png', imgs[0]);
  check('image name extracted', imgs[0]?.name === 'kitchen.png', imgs[0]);

  check('video is not treated as an image', extractImageAttachments(videoMsg).length === 0);
  const vids = extractVideoAttachments(videoMsg);
  check('video attachment found', vids.length === 1 && vids[0].url.endsWith('ref.mp4'), vids);

  // A spreadsheet has a content preview and no URL — must not be sent as an image.
  const sheetMsg =
    '[Attached File: leads.csv (spreadsheet)]\nContent preview:\na,b,c\n1,2,3\n\nInstruction: import';
  check('content-preview attachment yields no media', extractAttachments(sheetMsg).length === 0);

  check('plain text yields nothing', extractAttachments('just a question').length === 0);
  check('empty input is safe', extractAttachments('').length === 0);

  // Two images in one message.
  const two = `${imageMsg}\n\n[Attached File: b.jpg (image)]\nURL: https://x.test/b.jpg`;
  check('multiple images extracted', extractImageAttachments(two).length === 2, extractImageAttachments(two).length);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
