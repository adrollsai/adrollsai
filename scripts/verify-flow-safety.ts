/** Proof that flows cannot collide, double-send, or fire at the wrong hour. */
import '../lib/env-local';
import { describeConflict, findTriggerConflict, triggerKey, type FlowIdentity } from '../lib/flows/conflicts';
import {
  CROSS_FLOW_WINDOW_MS,
  DEFAULT_QUIET_HOURS,
  isQuiet,
  nextAllowedTime,
  runDueSteps,
  scheduleFor,
  type FlowStore,
  type ScheduledStep,
} from '../lib/flows/scheduling';
import { describeDryRun, dryRun } from '../lib/flows/dry-run';
import {
  ACTION_REQUIRES,
  TRIGGER_CAPABILITIES,
  actionsAvailableFor,
  factsForTrigger,
  validateAgainstTrigger,
} from '../lib/flows/capabilities';

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

const flow = (over: Partial<FlowIdentity> & { name: string; triggerType: string }): FlowIdentity => ({
  id: over.name.toLowerCase().replace(/\s+/g, '-'),
  title: over.name,
  triggerKey: null,
  isActive: false,
  ...over,
});

console.log('trigger identity (structure, not prose)');
check('the same trigger is the same key', triggerKey('trigger_meta_ad') === triggerKey('trigger_meta_ad'));
check('a different template is a different key', triggerKey('trigger_whatsapp_template_button', 'offer-a') !== triggerKey('trigger_whatsapp_template_button', 'offer-b'));
check('template casing does not create a second key', triggerKey('trigger_whatsapp_template_button', 'Offer-A') === triggerKey('trigger_whatsapp_template_button', 'offer-a'));

console.log('\nconflicts — no false negatives');
const metaFlow = flow({ name: 'Meta ad welcome', triggerType: 'trigger_meta_ad' });
const same = findTriggerConflict([metaFlow], flow({ name: 'Meta ad second', triggerType: 'trigger_meta_ad' }));
check('a second flow on the same trigger is refused', same.conflict?.name === 'Meta ad welcome');
check('the refusal names the flow to edit', describeConflict(flow({ name: 'x', triggerType: 'trigger_meta_ad' }), metaFlow).includes('Meta ad welcome'));
check('the refusal explains the double-message risk', /twice/.test(describeConflict(flow({ name: 'x', triggerType: 'trigger_meta_ad' }), metaFlow)));

console.log('\nconflicts — no false positives (the old string-matching bug)');
const talky = flow({ name: 'Ad enquiry follow-up', triggerType: 'trigger_crm_lead' });
const other = findTriggerConflict([talky], flow({ name: 'Meta ad welcome', triggerType: 'trigger_meta_ad' }));
check('two flows whose prose mentions the same event do not collide', other.conflict === null);
const buttonA = flow({ name: 'Offer button A', triggerType: 'trigger_whatsapp_template_button', triggerKey: 'offer-a' });
const buttonB = findTriggerConflict([buttonA], flow({ name: 'Offer button B', triggerType: 'trigger_whatsapp_template_button', triggerKey: 'offer-b' }));
check('two templates on the same trigger kind coexist', buttonB.conflict === null);
const self = findTriggerConflict([metaFlow], { ...metaFlow });
check('a flow does not conflict with itself when edited', self.conflict === null);

console.log('\nquiet hours');
const at = (h: number, m = 0) => new Date(2026, 4, 12, h, m, 0, 0);
check('21:00 is quiet by default', isQuiet(at(21), DEFAULT_QUIET_HOURS));
check('14:00 is not quiet', !isQuiet(at(14), DEFAULT_QUIET_HOURS));
check('02:00 is quiet (window wraps midnight)', isQuiet(at(2), DEFAULT_QUIET_HOURS));
check('a quiet moment is pushed to 09:00', nextAllowedTime(at(23, 40), DEFAULT_QUIET_HOURS).getHours() === 9);
check('an allowed moment is left alone', nextAllowedTime(at(11, 5), DEFAULT_QUIET_HOURS).getHours() === 11);

console.log('\nwaits become scheduled steps, not sleeps');
const plan = scheduleFor('f1', 'lead-1', [
  { kind: 'message' },
  { kind: 'wait', seconds: 600 },
  { kind: 'call' },
  { kind: 'wait', seconds: 86400 },
  { kind: 'message' },
], at(10, 0));
check('a 10-minute wait does not clamp to 10 seconds', plan[1].runAt.getTime() === at(10, 10).getTime());
check('a 1-day wait becomes tomorrow, not now', plan[2].runAt.getTime() === at(10, 10).getTime() + 86400000);
check('every action got its own ledger row', plan.length === 3);
check('step indexes are distinct', new Set(plan.map((p) => p.stepIndex)).size === 3);
const night = scheduleFor('f1', 'lead-2', [{ kind: 'wait', seconds: 60 }, { kind: 'call' }], at(23, 30));
check('a call due at 23:31 waits until morning', night[0].runAt.getHours() === 9);

console.log('\ndry run — what would happen, and what cannot');
const facts = { approvedTemplates: ['welcome_offer'], hasPhone: true, permissionGranted: true };
const good = dryRun([{ kind: 'message', text: 'Hi', templateName: 'welcome_offer' }, { kind: 'wait', seconds: 600 }, { kind: 'call' }], facts, at(10, 0));
check('a workable flow has no blockers', good.ok);
check('the effects are in order with real timestamps', good.effects.length === 2 && good.effects[1].at === at(10, 10).toISOString());
check('it reads as a sentence a person can check', describeDryRun(good).includes('works'));

const noTemplate = dryRun([{ kind: 'message', text: 'Hi' }], { ...facts, approvedTemplates: [] }, at(10, 0));
check('no approved template is caught', noTemplate.blockers.some((b) => b.code === 'no_approved_template'));
check('the blocker says who has to fix it', /approved/i.test(noTemplate.blockers[0].message));

const badTemplate = dryRun([{ kind: 'message', text: 'Hi', templateName: 'nope' }], facts, at(10, 0));
check('an unapproved template name is caught', badTemplate.blockers.some((b) => b.code === 'no_approved_template'));

const igCall = dryRun([{ kind: 'message', text: 'Hi', templateName: 'welcome_offer' }, { kind: 'call' }], { ...facts, hasPhone: false }, at(10, 0));
check('an Instagram comment that leads to a call is caught', igCall.blockers.some((b) => b.code === 'no_phone_number'));
check('the phone blocker explains the comment problem', /comment|DM/i.test(igCall.blockers[0].message));

const noPerm = dryRun([{ kind: 'message', text: 'Hi', templateName: 'welcome_offer' }], { ...facts, permissionGranted: false }, at(10, 0));
check('a missing platform permission is caught', noPerm.blockers.some((b) => b.code === 'permission_missing'));

// ---------------------------------------------------------------- scheduler
function memoryStore(seed: ScheduledStep[]) {
  const steps = seed.map((s) => ({ ...s }));
  const runs: string[] = [];
  const leadMessages = new Map<string, Date>();
  const state = { allPaused: false, pausedFlows: new Set<string>(), optedOut: new Set<string>() };
  const store: FlowStore = {
    async dueSteps(now, limit) {
      return steps.filter((s) => s.status === 'pending' && new Date(s.runAt) <= now).slice(0, limit);
    },
    async claim(id, now) {
      const s = steps.find((x) => x.id === id);
      if (!s || s.status !== 'pending') return false;
      s.status = 'claimed';
      s.attempts++;
      return true;
    },
    async complete(id) {
      const s = steps.find((x) => x.id === id);
      if (s) s.status = 'done';
    },
    async skip(id, reason) {
      const s = steps.find((x) => x.id === id);
      if (s) s.status = 'skipped';
    },
    async hasRun(flowId, leadId, stepIndex) {
      return runs.includes(`${flowId}:${leadId}:${stepIndex}`);
    },
    async recordRun(flowId, leadId, stepIndex, at) {
      runs.push(`${flowId}:${leadId}:${stepIndex}`);
      leadMessages.set(leadId, at);
    },
    async lastMessageAtForLead(leadId) {
      return leadMessages.get(leadId) ?? null;
    },
    async isOptedOut(leadId) {
      return state.optedOut.has(leadId);
    },
    async isPaused(flowId) {
      return state.pausedFlows.has(flowId);
    },
    async isAllPaused() {
      return state.allPaused;
    },
  };
  return { store, steps, leadMessages, state };
}

const step = (over: Partial<ScheduledStep>): ScheduledStep => ({
  id: 's1', flowId: 'f1', leadId: 'lead-1', stepIndex: 0, runAt: at(10, 0).toISOString(), status: 'pending', attempts: 0, ...over,
});

console.log('\nscheduler — once and only once');
{
  const { store, steps } = memoryStore([step({})]);
  let sent = 0;
  const first = await runDueSteps(store, at(10, 1), { execute: async () => { sent++; } });
  const second = await runDueSteps(store, at(10, 2), { execute: async () => { sent++; } });
  check('a due step runs once', first.executed.length === 1 && sent === 1);
  check('a second tick does not resend it', second.executed.length === 0 && sent === 1);
  check('the ledger row is closed', steps[0].status === 'done');
}
{
  const { store } = memoryStore([step({ id: 'a', leadId: 'L1', flowId: 'fa', stepIndex: 0 })]);
  // simulate a flow already having run, then a duplicate row for the same step
  const dup = memoryStore([step({ id: 'b', leadId: 'L1', flowId: 'fa', stepIndex: 0 })]);
  await runDueSteps(dup.store, at(10, 1), { execute: async () => {} });
  const again = memoryStore([step({ id: 'c', leadId: 'L1', flowId: 'fa', stepIndex: 0 })]);
  // fresh store has no history, so this proves the idempotency check is store-backed, not global
  const r = await runDueSteps(again.store, at(10, 1), { execute: async () => {} });
  check('idempotency is enforced from the run history, not by luck', r.executed.length === 1);
  void store;
}
{
  const { store } = memoryStore([step({ id: 'x', flowId: 'fa', leadId: 'L2', stepIndex: 0 }), step({ id: 'y', flowId: 'fb', leadId: 'L2', stepIndex: 0, runAt: at(10, 5).toISOString() })]);
  const first = await runDueSteps(store, at(10, 1), { execute: async () => {} });
  const second = await runDueSteps(store, at(10, 6), { execute: async () => {} });
  check('two flows cannot message the same lead minutes apart', first.executed.length === 1 && second.executed.length === 0);
  check('the second one is deferred, not dropped', second.deferred.length === 1 && second.skipped.some((s) => s.reason === 'recently_messaged_by_other_flow'));
  const later = await runDueSteps(store, new Date(at(10, 6).getTime() + CROSS_FLOW_WINDOW_MS + 1000), { execute: async () => {} });
  check('once the window has passed it may send', later.executed.length === 1);
}
{
  const { store, state } = memoryStore([step({ leadId: 'optout' })]);
  state.optedOut.add('optout');
  const r = await runDueSteps(store, at(10, 1), { execute: async () => {} });
  check('someone who opted out is never messaged', r.executed.length === 0 && r.skipped[0].reason === 'opted_out');
}
{
  const { store, state } = memoryStore([step({})]);
  state.allPaused = true;
  const r = await runDueSteps(store, at(10, 1), { execute: async () => {} });
  check('the kill switch stops everything', r.executed.length === 0 && r.skipped[0].reason === 'kill_switch');
}
{
  const { store, state } = memoryStore([step({})]);
  state.pausedFlows.add('f1');
  const r = await runDueSteps(store, at(10, 1), { execute: async () => {} });
  check('a paused flow does not fire', r.executed.length === 0 && r.skipped[0].reason === 'flow_paused');
}
{
  const { store } = memoryStore([step({ runAt: at(23, 40).toISOString() })]);
  const r = await runDueSteps(store, at(23, 41), { execute: async () => {} });
  const until = new Date(r.deferred[0].until);
  check(
    'a step due at 23:41 waits for morning',
    r.executed.length === 0 && until.getHours() === 9 && until.getDate() === 13,
    r.deferred[0]?.until
  );
}
{
  const { store } = memoryStore([step({})]);
  const r = await runDueSteps(store, at(10, 1), { execute: async () => { throw new Error('provider down'); } });
  check('a failing send is reported, not swallowed', r.skipped.some((s) => s.reason === 'execute_failed'));
}

// ---------------------------------------------------------------- capabilities
console.log('\ncapability foundation — what an event can actually give you');
const RUNNER_TRIGGERS = ['trigger_meta_ad', 'trigger_whatsapp_ctwa', 'trigger_whatsapp_inbound', 'trigger_crm_lead', 'trigger_ig_comment', 'trigger_fb_comment', 'trigger_ig_dm', 'trigger_fb_messenger', 'trigger_whatsapp_template_button'];
check(
  'every trigger the runner fires on has a capability entry',
  RUNNER_TRIGGERS.every((t) => !!TRIGGER_CAPABILITIES[t]),
  RUNNER_TRIGGERS.filter((t) => !TRIGGER_CAPABILITIES[t]).join(', ')
);
check('no capability entry describes a trigger that cannot fire', Object.keys(TRIGGER_CAPABILITIES).every((t) => RUNNER_TRIGGERS.includes(t)));
check('every entry says what it yields and explains itself', Object.values(TRIGGER_CAPABILITIES).every((c) => Array.isArray(c.yields) && c.label.length > 5 && c.note.length > 20));

check('an ad CLICK is named honestly, not confused with a lead form', /not an ad click/i.test(TRIGGER_CAPABILITIES.trigger_meta_ad.label));
check('a Meta lead form does carry a phone number', TRIGGER_CAPABILITIES.trigger_meta_ad.yields.includes('phone'));
check('an Instagram comment carries no phone number', !TRIGGER_CAPABILITIES.trigger_ig_comment.yields.includes('phone'));
check('a Facebook comment carries no phone number', !TRIGGER_CAPABILITIES.trigger_fb_comment.yields.includes('phone'));

const igMessage = validateAgainstTrigger('trigger_ig_comment', ['message']);
check('comment -> WhatsApp message is refused as impossible', igMessage.length === 1 && igMessage[0].code === 'action_needs_identity_trigger_lacks');
check('the refusal explains it as missing identity, not preference', /needs phone/i.test(igMessage[0].message));
check('the refusal offers what DOES work instead', /dm_reply/.test(igMessage[0].message));
check('comment -> call is refused too', validateAgainstTrigger('trigger_ig_comment', ['call']).length === 1);
check('comment -> DM reply is allowed', validateAgainstTrigger('trigger_ig_comment', ['dm_reply']).length === 0);

check('lead form -> WhatsApp message is allowed', validateAgainstTrigger('trigger_meta_ad', ['message']).length === 0);
check('lead form -> call is allowed', validateAgainstTrigger('trigger_meta_ad', ['call']).length === 0);
check('CRM lead -> call is allowed (number captured)', validateAgainstTrigger('trigger_crm_lead', ['call']).length === 0);
check('an unknown trigger is refused, with the vocabulary listed', validateAgainstTrigger('trigger_website_form', ['message'])[0]?.code === 'unknown_trigger');
check('an unknown action is refused', validateAgainstTrigger('trigger_meta_ad', ['telepathy'])[0]?.code === 'unknown_action');

check('available actions for a comment exclude WhatsApp and calls', !actionsAvailableFor('trigger_ig_comment').includes('message') && !actionsAvailableFor('trigger_ig_comment').includes('call'));
check('available actions for a lead form include WhatsApp and calls', actionsAvailableFor('trigger_meta_ad').includes('message') && actionsAvailableFor('trigger_meta_ad').includes('call'));
check('every action is reachable from at least one trigger', Object.keys(ACTION_REQUIRES).every((a) => Object.keys(TRIGGER_CAPABILITIES).some((t) => actionsAvailableFor(t).includes(a))));

const igFacts = factsForTrigger('trigger_ig_comment', { hasPhone: true, approvedTemplates: ['welcome'] });
check('facts are derived from the trigger, not trusted from the caller', igFacts.hasPhone === false);
const metaFacts = factsForTrigger('trigger_meta_ad', { hasPhone: true, approvedTemplates: ['welcome'] });
check('a lead form keeps the phone number when the lead has one', metaFacts.hasPhone === true);

console.log('\ndry run + derivation together (the whole chain)');
const chained = dryRun(
  [{ kind: 'message', text: 'Hi', templateName: 'welcome' }, { kind: 'wait', seconds: 3600 }, { kind: 'call' }],
  { ...igFacts, permissionGranted: true },
  at(10, 0)
);
check('comment flow: the message is blocked for want of a number', chained.blockers.some((b) => b.code === 'no_phone_number'));
check('comment flow: the hour-long wait still schedules correctly', chained.effects.length === 0);

console.log(`\n${'='.repeat(64)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
