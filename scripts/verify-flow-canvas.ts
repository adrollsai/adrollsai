/**
 * Proves a flow built in the editor can actually run.
 *
 * The editor was a dummy in the precise sense: it saved `trigger: { type: 'meta_ad' }` and nodes like
 * `action_whatsapp_questions`, while the scheduler only starts on `trigger_meta_ad` and only executes a
 * handful of node types. So a saved flow looked right, listed correctly, and was inert — `startFlowRun`
 * answered "unknown trigger" and stopped.
 *
 * These checks follow a flow from the canvas all the way to a scheduled step, which is the only proof
 * that matters: the runner must agree to plan it.
 *
 *   npm run verify:flow-canvas
 */
import { DEFAULT_RUNNER_TRIGGER, translateCanvasFlow } from '../lib/flows/canvas-translation';
import { planFromFlowDescription, storedTrigger } from '../lib/flows/start';
import { TRIGGER_CAPABILITIES } from '../lib/flows/capabilities';
import { planTimes } from '../lib/flows/sequence';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);

/** Everything the canvas is known to emit as a trigger. */
const CANVAS_TRIGGERS = [
  'meta_ad',
  'fb_lead_ad',
  'lead_form',
  'whatsapp_inbound',
  'whatsapp_ctwa',
  'template_button',
  'ig_comment',
  'fb_comment',
  'ig_dm',
  'messenger',
  'crm_lead',
  'campaign_audience',
  'csv_list',
  'portal_webhook',
  'landing_page',
  'group_distribution',
  'whatsapp_broadcast',
  'booking',
  'appointment',
];

head('1. Every trigger the canvas offers becomes a trigger the runner fires on');

{
  for (const canvasTrigger of CANVAS_TRIGGERS) {
    const translated = translateCanvasFlow({ trigger: { type: canvasTrigger, label: canvasTrigger }, nodes: [{ type: 'action_whatsapp_msg', config: { message: 'hi' } }] });
    const runnerTrigger = String(translated.trigger.type);
    check(
      `${canvasTrigger.padEnd(20)} → ${runnerTrigger}`,
      Boolean(TRIGGER_CAPABILITIES[runnerTrigger]),
      TRIGGER_CAPABILITIES[runnerTrigger] ? 'a real runner trigger' : 'NOT FIREABLE'
    );
  }

  const unknown = translateCanvasFlow({ trigger: { type: 'telepathy' }, nodes: [{ type: 'action_whatsapp_msg', config: { message: 'hi' } }] });
  check('an unknown trigger falls back to a fireable one', unknown.trigger.type === DEFAULT_RUNNER_TRIGGER, String(unknown.trigger.type));
  check('and says so rather than pretending', unknown.notes.length > 0, unknown.notes.join(' '));
  check('the original is kept for the owner to see', unknown.trigger.builderTrigger === 'telepathy', String(unknown.trigger.builderTrigger));
}

head('2. The nodes the canvas draws become steps the scheduler runs');

{
  const translated = translateCanvasFlow({
    trigger: { type: 'meta_ad' },
    nodes: [
      { id: 'n1', type: 'action_whatsapp_msg', config: { message: 'Thanks for your enquiry, {{lead.name}}.' } },
      { id: 'n2', type: 'action_delay', config: { minutes: 2880 } },
      { id: 'n3', type: 'action_whatsapp_questions', config: { questions: ['What are you looking for?', 'When do you need it?'], quickReplies: ['Now', 'Later'] } },
      { id: 'n4', type: 'action_crm_stage', config: { value: 'Qualified' } },
      { id: 'n5', type: 'action_ai_call', config: { description: 'Call to confirm the requirement' } },
    ],
  });

  check('nothing is reported as un-runnable', translated.problems.length === 0, translated.problems.map((p) => p.message).join('; ') || 'clean');
  check('all five nodes survived', translated.nodes.length === 5, `${translated.nodes.length} nodes`);
  check('a question bot became one interactive message', translated.nodes[2]?.type === 'whatsappMessageNode' && String(translated.nodes[2]?.data?.message).includes('What are you looking for'), String(translated.nodes[2]?.type));
  check('its quick replies became buttons', Array.isArray(translated.nodes[2]?.data?.buttons) && translated.nodes[2].data.buttons.length === 2);
  check('a CRM stage change became an internal action, not a dropped node', translated.nodes[3]?.type === 'action_ai_call_transfer' && translated.nodes[3]?.data?.kind === 'stage' && translated.nodes[3]?.data?.value === 'Qualified', JSON.stringify(translated.nodes[3]?.data));
  check('the delay kept its length in minutes', translated.nodes[1]?.data?.minutes === 2880, JSON.stringify(translated.nodes[1]?.data));
}

head('3. What cannot run is refused by name, not silently saved');

{
  const unsupported = translateCanvasFlow({
    trigger: { type: 'meta_ad' },
    nodes: [
      { id: 'x', type: 'action_whatsapp_msg', config: { message: 'hi' } },
      // A branch with nothing to compare is still un-runnable. Conditions themselves ARE supported
      // now (lib/flows/branching.ts, proven in verify:flow-branching) — but only when they say what
      // they compare, because a branch that cannot be evaluated would send everybody down one side.
      { id: 'y', type: 'action_condition', title: 'If interested' },
      { id: 'z', type: 'action_ig_send_dm', title: 'DM on Instagram' },
    ],
  });
  check('two problems are reported', unsupported.problems.length === 2, unsupported.problems.map((p) => p.nodeId).join(','));
  check('each names the node and why', unsupported.problems.every((p) => p.message.includes('"') && p.message.length > 30), unsupported.problems[0]?.message);
  check('the runnable node is still kept', unsupported.nodes.length === 1);
  check(
    'the condition is refused for having no field, not for being a condition',
    /no field to compare/.test(unsupported.problems.find((p) => p.nodeId === 'y')?.message ?? ''),
    unsupported.problems.find((p) => p.nodeId === 'y')?.message.slice(0, 90)
  );

  const branching = translateCanvasFlow({
    trigger: { type: 'meta_ad' },
    nodes: [
      { id: 'c', type: 'action_condition', title: 'New lead?', config: { field: 'pipeline_stage', operator: '==', value: 'New Lead' } },
      { id: 't', type: 'action_whatsapp_msg', branch: 'true', config: { message: 'Welcome' } },
      { id: 'f', type: 'action_whatsapp_msg', branch: 'false', config: { message: 'Still interested?' } },
    ],
  });
  check('a condition that says WHAT it compares is no longer refused', branching.problems.length === 0, JSON.stringify(branching.problems));
  check('and it reaches the runner as a condition node', branching.nodes.some((n) => n.type === 'conditionNode'));

  const empty = translateCanvasFlow({ trigger: { type: 'meta_ad' }, nodes: [] });
  check('an empty flow is a problem, not an empty save', empty.problems.length === 1, empty.problems[0]?.message);
}

head('4. The translated flow is a flow the runner plans');

{
  // Exactly what the editor writes for "message now, wait two days, message again", with the canvas's
  // own vocabulary — then handed to the real planner.
  const translated = translateCanvasFlow({
    trigger: { type: 'meta_ad', label: 'Meta lead form' },
    nodes: [
      { id: 'n1', type: 'action_whatsapp_msg', config: { message: 'Thanks {{lead.name}}, here is the catalogue.' } },
      { id: 'n2', type: 'action_delay', config: { days: 2 } },
      { id: 'n3', type: 'action_whatsapp_msg', config: { message: 'Still interested? I can book you a time.' } },
    ],
  });

  const description = JSON.stringify({ name: 'Editor flow', isActive: true, trigger: translated.trigger, nodes: translated.nodes });
  const parsed = planFromFlowDescription(description);
  check('the runner reads the stored flow with no problems', parsed.problems.length === 0, parsed.problems.join('; ') || 'clean');
  check('it recognises the trigger', parsed.triggerType === 'trigger_meta_ad', String(parsed.triggerType));
  check('it sees both messages and the wait', parsed.actions.length === 3, parsed.actions.map((a) => a.kind).join(','));

  const START = new Date('2026-11-25T04:30:00Z');
  const plan = planTimes(parsed.actions, { startAt: START, quiet: { startHour: 0, endHour: 0 } });
  check('the plan has two sends', plan.at.length === 2, `${plan.at.length}`);
  check('the second lands two days later', plan.at[1] && Math.round((plan.at[1].runAt.getTime() - START.getTime()) / 60000) === 2880, plan.at[1] ? `${Math.round((plan.at[1].runAt.getTime() - START.getTime()) / 60000)} min` : 'missing');

  const trigger = storedTrigger(description);
  check('the stored trigger is one the runner fires on', Boolean(TRIGGER_CAPABILITIES[String(trigger?.type)]), String(trigger?.type));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
