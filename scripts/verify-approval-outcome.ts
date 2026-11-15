/**
 * Proves an approval reports what actually happens.
 *
 * The route used to answer a WhatsApp approval with "Successfully launched WhatsApp broadcast
 * to 400 leads" having sent nothing, and an ad-spend approval with "Custom action executed
 * successfully" having done nothing at all. That is the failure mode a launch cannot survive:
 * one checkable lie poisons every other number in the product.
 *
 * So this gate asserts two things: what the outcome object can say, and that the route ships no
 * sentence of its own that claims work already happened.
 *
 *   npm run verify:approval-outcome
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FORBIDDEN_CLAIM_PATTERNS,
  approvalOutcome,
  claimsExecution,
  describeAction,
  rejectionOutcome,
} from '../lib/agent/approval-outcome';
import { REVIEW_POLICY } from '../lib/agent/review-gate';

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

const root = process.cwd();
const routeSource = readFileSync(join(root, 'app/api/agent/v2/action/route.ts'), 'utf8');
// Comments are strip-checked separately: the file documents the old bug, and quoting the lie in
// a comment is not the same as shipping it. Only executed code is judged here.
const routeCode = routeSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

head('1. Approving unlocks the gate — it never claims the work is done');

const actionTypes = ['whatsapp_broadcast', 'bulk_call', 'ad_spend', 'create_asset', 'delete_data', 'custom', 'something_new'];

check(
  'every action type is marked approved and resumed, never executed',
  actionTypes.every((type) => {
    const outcome = approvalOutcome(type);
    return outcome.status === 'approved' && outcome.resumed === true && outcome.executed === false;
  }),
  `${actionTypes.length} action types`,
);
check(
  'no action type can report a completed status',
  actionTypes.every((type) => (approvalOutcome(type) as any).status !== 'completed'),
  'status is structurally "approved"',
);
check(
  'the message says what happens NEXT, not what already happened',
  actionTypes.every((type) => {
    const message = approvalOutcome(type).message;
    return /continuing|now/i.test(message) && !claimsExecution(message);
  }),
  approvalOutcome('whatsapp_broadcast').message.slice(0, 80),
);
check(
  'it is honest that nothing had been sent before the approval',
  /nothing had been sent before/i.test(approvalOutcome('whatsapp_broadcast').message),
  'stated plainly',
);
check(
  'an unknown action type does not invent an execution',
  approvalOutcome('something_new').executed === false && describeAction('something_new') === 'action',
  'falls back to "action", not a fake success',
);
check(
  'rejection says nothing was spent or sent, and no retry happens on its own',
  rejectionOutcome().status === 'rejected' &&
    /nothing was sent/i.test(rejectionOutcome().message) &&
    /will not retry it on its own/i.test(rejectionOutcome().message),
  rejectionOutcome().message.slice(0, 70),
);
check(
  'each approved action is described in the owner\'s words',
  describeAction('whatsapp_broadcast') === 'WhatsApp message' &&
    describeAction('bulk_call') === 'batch of calls' &&
    describeAction('ad_spend') === 'ad campaign',
  'no jargon',
);

head('2. The claim detector catches the sentences that shipped before');

const realBugs = [
  'Successfully launched WhatsApp broadcast to 400 leads.',
  'Queued 400 leads for autonomous voice followup.',
  'Custom action executed successfully.',
  'Your campaign has been launched.',
  'Message delivered to 250 customers.',
];
check(
  'every previous fabricated sentence is detected',
  realBugs.every((text) => claimsExecution(text)),
  `${realBugs.length} known lies`,
);
check(
  'honest sentences are not flagged',
  [
    approvalOutcome('ad_spend').message,
    rejectionOutcome().message,
    'Approved. The agent is continuing with the creative in the chat now.',
  ].every((text) => !claimsExecution(text)),
  'no false positives on the honest copy',
);
check(
  'the detector is not case-sensitive',
  claimsExecution('SUCCESSFULLY LAUNCHED the campaign') &&
    claimsExecution('Action EXECUTED SUCCESSFULLY'),
  'shouting does not evade it',
);

head('3. The route ships no claim of its own');

check(
  'the route builds its answer from approvalOutcome, not hand-written prose',
  /approvalOutcome\(/.test(routeSource) && /rejectionOutcome\(/.test(routeSource),
  'single source of truth',
);
check(
  'the old strings are gone from the route',
  !/Successfully launched/i.test(routeCode) &&
    !/executed successfully/i.test(routeCode) &&
    !/Queued \$\{/.test(routeCode),
  'no fabricated success text remains in code',
);
check(
  'the route never sets a terminal status for an approved action',
  !/status:\s*'completed'/.test(routeSource) && !/status:\s*'in_progress'/.test(routeSource),
  'approved is the stop, the agent does the work',
);
check(
  'no action type is special-cased into an execution branch',
  !/actionType === '(whatsapp_broadcast|bulk_call|ad_spend)'/.test(routeSource),
  'one honest path for every type',
);
check(
  'every policy action type an owner can approve is covered by the module',
  Object.values(REVIEW_POLICY)
    .map((policy) => policy.actionType)
    .every((type) => approvalOutcome(type).executed === false),
  `${Object.keys(REVIEW_POLICY).length} gated tools`,
);
check(
  'the forbidden-pattern list is not empty (the check cannot pass vacuously)',
  FORBIDDEN_CLAIM_PATTERNS.length >= 4,
  `${FORBIDDEN_CLAIM_PATTERNS.length} patterns`,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
