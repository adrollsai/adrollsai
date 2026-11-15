/**
 * Proves the approval card can actually continue the job.
 *
 * THE FAILURE THIS PINS
 * Tapping Approve in production recorded the decision and then nothing happened. The card said
 * "Approved & in progress", the row flipped to `approved`, and no run was ever created — the
 * work never started. The cause was a single dropped prop: the durable transcript (the DEFAULT
 * render path) accepted `onOptionSelect` but not `onResume`, so the card had no way to hand the
 * staged instruction back to the conversation.
 *
 * Every approval on the default path was a dead end, and nothing caught it because each unit
 * worked in isolation: the card resumed correctly when a handler was passed, and the handler was
 * correct when it was called. The wire between them was missing.
 *
 * So this gate checks the WIRE, at every render site, not the units.
 *
 *   npm run verify-approval-resume
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildResumePrompt } from '../lib/agent/resume-prompt';

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

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
// Comments quote the bug; only shipped code is judged.
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const transcript = code(read('components/agent/HarnessTranscript.tsx'));
const chat = code(read('components/agent/AgentChat.tsx'));
const feed = code(read('components/agent/FeedRows.tsx'));
const card = code(read('components/agent/ActionConfirmationCard.tsx'));

head('1. The card resumes the conversation when approved');

check(
  'approving calls onResume with the staged instruction',
  /onResume\(\s*buildResumePrompt\(/.test(card),
  'the card hands the job back',
);
check(
  'it only resumes when a handler is actually wired',
  /if \(onResume\) \{/.test(card) && /actionId: artifact\.actionId/.test(card),
  'no empty send, and always labelled with the action',
);
check(
  'rejecting does not resume anything',
  (() => {
    // Look at the actual branch structure, not the whole file: 'rejected' also appears in the
    // status type, and a loose proximity check would flag that instead of the real thing.
    const approvedAt = card.indexOf("decision === 'approved'");
    if (approvedAt < 0) return false;
    const elseAt = card.indexOf('} else {', approvedAt);
    if (elseAt < 0) return false;
    const approvedBranch = card.slice(approvedAt, elseAt);
    const rejectBranch = card.slice(elseAt, card.indexOf('} finally', elseAt));
    return approvedBranch.includes('onResume(') && !rejectBranch.includes('onResume(');
  })(),
  'a cancellation stays cancelled',
);

head('2. Every tool row can reach that handler');

check(
  'the tool row forwards onResume into the confirmation card',
  /<ActionConfirmationCard[^>]*onResume=\{onResume\}/.test(feed),
  'FeedRows → card',
);
check(
  'the tool row accepts the prop at all',
  /onResume\?:\s*\(prompt:\s*string\)\s*=>\s*void/.test(feed),
  'typed, not any',
);

head('3. The durable transcript — the default path — carries it');

check(
  'HarnessTranscript declares onResume',
  /onResume\?:\s*\(prompt:\s*string\)\s*=>\s*void/.test(transcript),
  'THE BUG: this prop did not exist',
);
check(
  'HarnessTranscript forwards it to the tool row',
  /<ToolFeedRow[\s\S]{0,400}?onResume=\{onResume\}/.test(transcript),
  'ToolItem → ToolFeedRow',
);
check(
  'ToolItem accepts and passes it through',
  /function ToolItem\(\{[\s\S]{0,120}?onResume/.test(transcript) &&
    /onResume=\{stableResume\}/.test(transcript),
  'memoised without dropping the handler',
);
check(
  'the stable wrapper keeps the latest handler without breaking memoisation',
  /resumeRef\.current\s*=\s*onResume/.test(transcript) &&
    /React\.useCallback\(\(prompt: string\)\s*=>\s*resumeRef\.current\?\.\(prompt\), \[\]\)/.test(transcript),
  'same trick as onOptionSelect',
);

head('4. Every render site of the transcript passes a handler');

const sites = [...chat.matchAll(/<HarnessTranscript[\s\S]{0,320}?\/>/g)].map((match) => match[0]);
check('there is at least one render site', sites.length > 0, `${sites.length} site(s)`);
check(
  'every site passes onResume',
  sites.every((site) => /onResume=\{handleSend\}/.test(site)),
  sites.length === 1 ? 'the agent pane' : `${sites.length} sites`,
);
check(
  'no site passes only onOptionSelect',
  !sites.some((site) => /onOptionSelect=\{handleSend\}/.test(site) && !/onResume=/.test(site)),
  'the dropped-prop shape cannot come back',
);

head('5. The live-streaming path still works too');

check(
  'the non-durable renderer passes onResume as well',
  /<ToolFeedRow[\s\S]{0,400}?onResume=\{handleSend\}/.test(chat),
  'both paths, or one of them is a dead end',
);

head('6. The resume sentence ends the approval cycle instead of restarting it');

const resumeFor = (over: Record<string, unknown> = {}) =>
  buildResumePrompt({
    actionId: 'act_abc123',
    actionType: 'create_asset',
    title: 'Grand Opening 1:1',
    resumePrompt: 'Approved — generate the image now.',
    ...over,
  });

check(
  'it states the decision as a decision, not a request',
  /already reviewed and APPROVED/i.test(resumeFor()),
  'approved, not "please"',
);
check(
  'it names the approval reference so the gate and transcript agree',
  resumeFor().includes('act_abc123'),
  'actionId carried',
);
check(
  'it forbids asking for the same approval twice',
  /do not call request_human_approval for it a second time/i.test(resumeFor()),
  'the loop is named and closed',
);
check(
  'it tells the agent to execute with the staged details',
  /exactly the details that were staged and approved/i.test(resumeFor()),
  'so the fingerprint matches',
);
check(
  'it says what to do if the gate refuses on a mismatch',
  /tell the owner precisely what differs/i.test(resumeFor()) &&
    /never ask for the same approval twice/i.test(resumeFor()),
  'honest failure instead of another card',
);
check(
  'the model\'s own sentence is kept as context, not as the instruction',
  /The staged instruction was: Approved — generate the image now\./i.test(resumeFor()),
  'context preserved',
);
check(
  'an unknown action type still produces a usable sentence',
  /approved this action/i.test(resumeFor({ actionType: 'something_new', title: undefined })),
  'no undefined in the copy',
);
check(
  'a missing actionId does not produce a broken reference',
  /Approval reference: unknown/.test(resumeFor({ actionId: '' })),
  'degrades safely',
);
check(
  'the card builds the prompt itself rather than trusting the model prose',
  /buildResumePrompt\(/.test(card) && !/onResume\(artifact\.resumePrompt\)/.test(card),
  'one deterministic sentence',
);

head('7. The send queue cannot swallow an approval resume');

check(
  'the flush effect re-runs when something is queued, not only on a loading transition',
  /\}, \[isLoading, isUploading, queuedCount\]\);/.test(chat),
  'queuedCount is a dependency',
);
check(
  'it sends from a timer instead of the effect body',
  /const timer = setTimeout\(/.test(chat) && /return \(\) => clearTimeout\(timer\)/.test(chat),
  'no work in the render-commit path',
);
check(
  'the timer reads live flags rather than the scheduler closure',
  /isLoadingRef\.current/.test(chat) && /isUploadingRef\.current/.test(chat),
  'a stale closure cannot block the flush',
);
check(
  'a lock prevents flushing the same queue twice',
  /flushingRef\.current = true/.test(chat) && /flushingRef\.current = false/.test(chat),
  'no double send',
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
