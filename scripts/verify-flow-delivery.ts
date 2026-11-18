/**
 * Proof that a flow can reach a person — and only after a human said yes.
 *
 * The scheduler tests (verify:flow-safety) prove a step is due at the right time and fires once.
 * They cannot prove the step has a destination, which is the bug this file exists for: for a while
 * every flow step was written to a queue that nothing read, so a "working" flow reached nobody.
 *
 * Two halves, both pure, no database:
 *   delivery — what MAY be sent, and every honest reason it may not be.
 *   ingress  — which stored flow listens for a real event, and which trigger that event IS.
 */
import '../lib/env-local';
import { dispatchBlockers, describeDelivery, mapDelivery, type Delivery, type DispatchFacts } from '../lib/flows/delivery';
import { fireFlowTrigger, inboundTriggerFor, matchesFlowTrigger } from '../lib/flows/ingress';
import { planFromFlowDescription, storedTrigger } from '../lib/flows/start';
import { scheduleFor } from '../lib/flows/scheduling';
import { NODE_SPECS, validateFlow } from '../lib/flows/schema';

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'd1',
  userId: 'u1',
  leadId: 'lead-1',
  leadName: 'Asha',
  leadPhone: '919888888888',
  channel: 'whatsapp',
  toPhone: '919888888888',
  body: 'Hello',
  templateName: null,
  flowId: 'f1',
  flowStepIndex: 0,
  trigger: 'trigger_whatsapp_inbound',
  runKey: 'once',
  status: 'approved',
  attempts: 0,
  errorMessage: null,
  providerMessageId: null,
  createdAt: new Date().toISOString(),
  approvedAt: null,
  sentAt: null,
  ...over,
});

const open: DispatchFacts = { windowOpen: true, optedOut: false };
const closed: DispatchFacts = { windowOpen: false, optedOut: false };
const codes = (d: Delivery, facts: DispatchFacts) => dispatchBlockers(d, facts).map((b) => b.code);

// ────────────────────────────────────────────────────────── what may be sent
console.log('the delivery gate — what may be sent');
check('free text inside the 24-hour window is sendable', codes(delivery(), open).length === 0, codes(delivery(), open).join(','));
check(
  'free text OUTSIDE the window is refused, not attempted',
  codes(delivery(), closed).includes('window_closed'),
  codes(delivery(), closed).join(',')
);
check(
  'and the refusal names the fix (attach a template, or wait for a reply)',
  /template/i.test(dispatchBlockers(delivery(), closed).find((b) => b.code === 'window_closed')?.message ?? '')
);
check(
  'an approved TEMPLATE is sendable at any hour',
  codes(delivery({ body: null, templateName: 'welcome_offer' }), closed).length === 0,
  codes(delivery({ body: null, templateName: 'welcome_offer' }), closed).join(',')
);
check('a call needs an objective, not a window', codes(delivery({ channel: 'call', body: 'ask about budget' }), closed).length === 0);
check(
  'a call with nothing to say is refused',
  codes(delivery({ channel: 'call', body: '   ' }), open).includes('no_content')
);
check('a lead with no number is never messaged', codes(delivery({ toPhone: null, leadPhone: null }), open).includes('no_phone'));
check('a step with neither text nor template is refused', codes(delivery({ body: null }), open).includes('no_content'));
check('someone who opted out is never messaged', codes(delivery(), { windowOpen: true, optedOut: true }).includes('opted_out'));
check(
  'a delivery not attached to a lead cannot be sent',
  codes(delivery({ leadId: null }), open).includes('no_lead')
);
check(
  'every blocker is a sentence a person can act on',
  dispatchBlockers(delivery({ body: ' ' }), closed).every((b) => b.message.length > 25 && b.message.endsWith('.'))
);

console.log('\nthe delivery queue reads as work, not as rows');
check(
  'a row becomes a sentence naming the person and the action',
  /Send a WhatsApp message to Asha/.test(describeDelivery(delivery())),
  describeDelivery(delivery())
);
check(
  'a template delivery says which template',
  /welcome_offer/.test(describeDelivery(delivery({ templateName: 'welcome_offer' }))),
  describeDelivery(delivery({ templateName: 'welcome_offer' }))
);
check('a call delivery says it is a call', /AI call/.test(describeDelivery(delivery({ channel: 'call' }))));
check(
  'a row with no name falls back to the number it will use',
  /919888888888/.test(describeDelivery(delivery({ leadName: null }))),
  describeDelivery(delivery({ leadName: null }))
);
check(
  'mapping tolerates the old table shape (no channel, no run_key)',
  mapDelivery({ id: 'x', user_id: 'u', status: 'pending_approval', created_at: 'now' }).channel === 'whatsapp',
  JSON.stringify(mapDelivery({ id: 'x', user_id: 'u', status: 'pending_approval', created_at: 'now' }))
);
check('and defaults the run key to once', mapDelivery({ id: 'x', user_id: 'u' }).runKey === 'once');

// ────────────────────────────────────────────────────────── which event is it
console.log('\nwhich event is it — the trigger vocabulary');
check('an ordinary message is an inbound trigger', inboundTriggerFor({}) === 'trigger_whatsapp_inbound');
check('a message from a click-to-WhatsApp ad is a ctwa trigger', inboundTriggerFor({ isFromAd: true }) === 'trigger_whatsapp_ctwa');
check(
  'a tapped template button is its own trigger, not an ordinary message',
  inboundTriggerFor({ buttonId: 'interested', isFromAd: true }) === 'trigger_whatsapp_template_button'
);

// ────────────────────────────────────────────────────────── who listens for it
console.log('\nwhich stored flow listens for this event');
const stored = (desc: object) => ({ trigger: storedTrigger(JSON.stringify(desc)) });
const inboundFlow = stored({ trigger: { type: 'trigger_whatsapp_inbound' }, nodes: [] });

const matchAny = matchesFlowTrigger(inboundFlow, { trigger: 'trigger_whatsapp_inbound', text: 'hello' });
check('an inbound flow matches an inbound message', matchAny.matches, matchAny.why);
const wrongTrigger = matchesFlowTrigger(inboundFlow, { trigger: 'trigger_crm_lead' });
check('it does not match a different event', !wrongTrigger.matches && /listens on trigger_whatsapp_inbound/.test(wrongTrigger.why), wrongTrigger.why);

const keywordFlow = stored({ trigger: { type: 'trigger_whatsapp_inbound', keywords: ['price', 'Brochure'] }, nodes: [] });
check('a keyword flow matches when the keyword appears (case-insensitive)', matchesFlowTrigger(keywordFlow, { trigger: 'trigger_whatsapp_inbound', text: 'send me the BROCHURE' }).matches);
check('and does not match when it does not', !matchesFlowTrigger(keywordFlow, { trigger: 'trigger_whatsapp_inbound', text: 'hello there' }).matches);
check(
  'the miss explains which keywords it waits for',
  /price, brochure/i.test(matchesFlowTrigger(keywordFlow, { trigger: 'trigger_whatsapp_inbound', text: 'hi' }).why),
  matchesFlowTrigger(keywordFlow, { trigger: 'trigger_whatsapp_inbound', text: 'hi' }).why
);

const buttonFlow = stored({ trigger: { type: 'trigger_whatsapp_inbound', button_id: 'interested' }, nodes: [] });
check('a button flow matches its own button', matchesFlowTrigger(buttonFlow, { trigger: 'trigger_whatsapp_inbound', buttonId: 'interested' }).matches);
check('a different button is a different event', !matchesFlowTrigger(buttonFlow, { trigger: 'trigger_whatsapp_inbound', buttonId: 'later' }).matches);
check('a plain message does not match a button flow', !matchesFlowTrigger(buttonFlow, { trigger: 'trigger_whatsapp_inbound', text: 'hello' }).matches);
check('a flow with no recorded trigger matches nothing, not everything', !matchesFlowTrigger(stored({ nodes: [] }), { trigger: 'trigger_whatsapp_inbound', text: 'hi' }).matches);

// ────────────────────────────────────────────────────────── firing needs a database
console.log('\nfiring without a database says so instead of pretending');
const emptyDb: any = {
  from: () => ({
    select: () => ({
      eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    }),
  }),
};
const quiet = await fireFlowTrigger(emptyDb, { userId: 'u1', trigger: 'trigger_whatsapp_inbound', leadId: 'lead-1', text: 'hi' });
check('no matching flow means nothing started and nothing claimed', quiet.fired === false && quiet.started.length === 0);
const brokenDb: any = {
  from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: 'relation does not exist' } }) }) }) }) }),
};
const broken = await fireFlowTrigger(brokenDb, { userId: 'u1', trigger: 'trigger_whatsapp_inbound', leadId: 'lead-1' });
check(
  'a database it cannot read is reported, not thrown at the webhook',
  broken.fired === false && broken.skipped.some((s) => /could not read/.test(s.why)),
  JSON.stringify(broken.skipped)
);

// ────────────────────────────────────────────────────────── the three rescued nodes
console.log('\nthe nodes that used to be skipped silently');
const interactive = planFromFlowDescription(
  JSON.stringify({
    trigger: { type: 'trigger_whatsapp_inbound' },
    nodes: [
      { type: 'triggerNode' },
      { type: 'action_whatsapp_interactive', data: { message: 'What are you looking for?', buttons: [{ id: 'buy', title: 'Buy' }, { title: 'Rent' }] } },
    ],
  })
);
check('an interactive message becomes a message step with buttons', interactive.actions[0]?.kind === 'message' && interactive.actions[0]?.buttons?.length === 2);
check('a button without an id still gets one', interactive.actions[0]?.buttons?.[1]?.id === 'flow_btn_1');
check('no problems for a plain interactive step', interactive.problems.length === 0, interactive.problems.join('; '));

const compose = planFromFlowDescription(
  JSON.stringify({
    trigger: { type: 'trigger_whatsapp_inbound' },
    nodes: [
      { type: 'ai_deepseek', data: { prompt: 'write a warm reply about their project' } },
      { type: 'whatsappMessageNode', data: { message: 'placeholder' } },
    ],
  })
);
check('an AI step attaches itself to the message after it', compose.actions[0]?.compose?.prompt === 'write a warm reply about their project');
check('and the message it personalises is still one step', compose.actions.length === 1 && compose.actions[0].kind === 'message');
const orphanAi = planFromFlowDescription(
  JSON.stringify({ trigger: { type: 'trigger_whatsapp_inbound' }, nodes: [{ type: 'ai_deepseek', data: { prompt: 'x' } }, { type: 'whatsappMessageNode', data: { message: 'y' } }] })
);
check('an AI step with an action after it is fine', orphanAi.problems.length === 0, orphanAi.problems.join('; '));
const trailingAi = planFromFlowDescription(
  JSON.stringify({ trigger: { type: 'trigger_whatsapp_inbound' }, nodes: [{ type: 'whatsappMessageNode', data: { message: 'y' } }, { type: 'ai_deepseek', data: { prompt: 'x' } }] })
);
check('an AI step with nothing after it is a problem, not a no-op', trailingAi.problems.some((p) => /nothing after it/i.test(p)));

const handoff = planFromFlowDescription(
  JSON.stringify({
    trigger: { type: 'trigger_whatsapp_inbound' },
    nodes: [{ type: 'whatsappMessageNode', data: { message: 'hi' } }, { type: 'action_ai_call_transfer', data: { agent: '0e0b7b3e-1c2d-4f5a-8b9c-0d1e2f3a4b5c' } }],
  })
);
check('a transfer-to-human step becomes a handoff', handoff.actions[1]?.kind === 'handoff');
check('and it carries the agent to assign', handoff.actions[1]?.internal?.kind === 'assign');
check('a handoff needs no phone number or template to be legal', handoff.problems.length === 0, handoff.problems.join('; '));

const unknownNode = planFromFlowDescription(
  JSON.stringify({ trigger: { type: 'trigger_whatsapp_inbound' }, nodes: [{ type: 'whatsappMessageNode', data: { message: 'hi' } }, { type: 'action_ig_send_dm', data: {} }] })
);
check('a node the scheduler cannot run is reported, never skipped in silence', unknownNode.problems.some((p) => /action_ig_send_dm/.test(p)));

console.log('\nhandoffs schedule like work, but wait for nobody');
const at10 = new Date(2026, 4, 12, 10, 0, 0, 0);
const nightPlan = scheduleFor('f1', 'l1', [{ kind: 'wait', seconds: 60 }, { kind: 'handoff' }], new Date(2026, 4, 12, 23, 30, 0, 0));
check('a handoff at 23:31 runs at 23:31, not at 09:00', nightPlan[0]?.runAt.getHours() === 23, String(nightPlan[0]?.runAt));
const runKeyed = scheduleFor('f1', 'l1', [{ kind: 'message' }], at10, undefined, 'msg:abc');
check('a run key travels into every row', runKeyed.every((r) => r.runKey === 'msg:abc'));
const twice = scheduleFor('f1', 'l1', [{ kind: 'message' }], at10, undefined, 'msg:def');
check('a different run key is a different run', twice[0]?.runKey !== runKeyed[0]?.runKey);

// ────────────────────────────────────────────────────────── the editor contract
console.log('\nthe palette tells the truth about the engine');
const supported = ['ai_deepseek', 'action_ai_call_transfer', 'action_whatsapp_interactive'];
for (const type of supported) {
  const spec = NODE_SPECS.find((s) => s.type === type);
  check(`${type} is offered to the builder as executable`, spec?.support === 'executed', spec?.support);
  check(`${type} explains what actually happens`, (spec?.note ?? '').length > 40);
}
for (const type of ['action_ig_comment_reply', 'action_ig_send_dm', 'action_ig_card', 'action_fb_comment_reply', 'action_fb_send_messenger']) {
  const spec = NODE_SPECS.find((s) => s.type === type);
  check(`${type} is still blocked, with the real reason`, spec?.support === 'unsupported' && /credentials|wired|needs/i.test(spec?.note ?? ''), spec?.note?.slice(0, 60));
}
const publishable = validateFlow({
  nodes: [
    { id: 't', type: 'triggerNode', data: {} },
    { id: 'x', type: 'action_whatsapp_interactive', data: { message: 'hi', buttons: [] } },
  ],
  edges: [{ source: 't', target: 'x' }],
});
check('a flow using an interactive message now publishes', publishable.ok === true, publishable.issues.map((i) => i.message).join('; '));

console.log(`\n${'='.repeat(64)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
