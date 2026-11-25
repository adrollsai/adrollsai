/**
 * BRANCHING GATE: a condition node decides who runs which side — at step time.
 *
 * The flow editor drew conditions for months and the scheduler refused them at activation, because a
 * straight line of ledger rows has nowhere to "jump". The refusal was honest. This is the feature,
 * and this gate is what stops it going back to a refusal or, worse, to a condition that is drawn but
 * never evaluated (both branches firing, or one branch silently firing for everybody).
 *
 * Proves, without a database and without a model:
 *   1. a canvas condition translates instead of being refused, and its unusable variants are still
 *      refused BY NAME;
 *   2. the side of the branch survives into the stored flow, and onto each step of the plan;
 *   3. the predicate really discriminates one lead shape from another (including `>=`, which is the
 *      editor's default operator);
 *   4. the scheduler retires the side the lead is not on, with a reason, and runs the side it is;
 *   5. when the lead cannot be read the step is neither run nor retired.
 *
 *   npm run verify:flow-branching
 */
import { translateCanvasFlow } from '../lib/flows/canvas-translation';
import { planFromFlowDescription } from '../lib/flows/start';
import { evaluateGates, gateFor, normaliseOperator, readCondition } from '../lib/flows/branching';
import { runDueSteps, type FlowStore, type ScheduledStep } from '../lib/flows/scheduling';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  -- ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  -- ${detail}` : ''}`);
  }
};
const head = (title: string) => console.log(`\n== ${title} ${'='.repeat(Math.max(0, 60 - title.length))}`);

const conditionNode = {
  id: 'cond_1',
  type: 'action_condition',
  title: 'New lead?',
  branch: 'main',
  config: { evaluationType: 'crm_attribute', field: 'pipeline_stage', operator: '==', value: 'New Lead' },
};
const trueStep = {
  id: 'step_true',
  type: 'action_whatsapp_msg',
  title: 'Welcome the new lead',
  branch: 'true',
  config: { message: 'Hi {{lead.name}}, thanks for reaching out.' },
};
const falseStep = {
  id: 'step_false',
  type: 'action_whatsapp_msg',
  title: 'Nudge the older lead',
  branch: 'false',
  config: { message: 'Hi {{lead.name}}, still interested?' },
};

// ── 1. translation ──────────────────────────────────────────────────────────
head('1. the canvas condition translates instead of being refused');
{
  const translated = translateCanvasFlow({
    trigger: { type: 'crm_lead' },
    nodes: [conditionNode, trueStep, falseStep],
  });
  check('a flow with a condition has no blocking problems', translated.problems.length === 0, JSON.stringify(translated.problems));
  const condition = translated.nodes.find((n) => n.type === 'conditionNode');
  check('the condition became a conditionNode', Boolean(condition), condition?.type);
  check('it carries the field it compares', condition?.data?.field === 'pipeline_stage', String(condition?.data?.field));
  check('and the operator, normalised', condition?.data?.operator === 'equals', String(condition?.data?.operator));
  const sides = translated.nodes.map((n: any) => `${n.id}:${n.branch ?? '-'}`);
  check('both sides of the branch survive into the stored flow', sides.includes('step_true:true') && sides.includes('step_false:false'), sides.join(', '));

  // A branch that cannot be evaluated is still refused, by name.
  const noField = translateCanvasFlow({
    trigger: { type: 'crm_lead' },
    nodes: [{ ...conditionNode, config: { ...conditionNode.config, field: '' } }, trueStep],
  });
  check('a condition with no field is refused', noField.problems.length === 1, noField.problems[0]?.message.slice(0, 80));
  const badField = translateCanvasFlow({
    trigger: { type: 'crm_lead' },
    nodes: [{ ...conditionNode, config: { ...conditionNode.config, field: 'qualification_score' } }, trueStep],
  });
  check(
    'a condition on a field a lead does not have is refused with the reason',
    badField.problems.length === 1 && /not a field a lead has/.test(badField.problems[0].message),
    badField.problems[0]?.message.slice(0, 90)
  );
  const badOp = translateCanvasFlow({
    trigger: { type: 'crm_lead' },
    nodes: [{ ...conditionNode, config: { ...conditionNode.config, operator: 'sounds_like' } }, trueStep],
  });
  check('an operator the runner cannot evaluate is refused', badOp.problems.length === 1, badOp.problems[0]?.message.slice(0, 80));
  const stillRefused = translateCanvasFlow({
    trigger: { type: 'crm_lead' },
    nodes: [{ id: 'q', type: 'action_qualify', title: 'AI qualify' }],
  });
  check('the other unsupported nodes are still refused', stillRefused.problems.length === 1, stillRefused.problems[0]?.message.slice(0, 70));
}

// ── 2. the plan ─────────────────────────────────────────────────────────────
head('2. each step carries the predicate that guards it');
{
  const translated = translateCanvasFlow({ trigger: { type: 'crm_lead' }, nodes: [conditionNode, trueStep, falseStep] });
  const plan = planFromFlowDescription(JSON.stringify(translated));
  check('the plan has no problems', plan.problems.length === 0, JSON.stringify(plan.problems));
  check('the condition is not itself a scheduled step', plan.actions.length === 2, `${plan.actions.length} actions`);
  const [first, second] = plan.actions;
  check('the TRUE-side step is gated want:true', first?.gates?.[0]?.want === true, JSON.stringify(first?.gates?.[0]?.want));
  check('the FALSE-side step is gated want:false', second?.gates?.[0]?.want === false, JSON.stringify(second?.gates?.[0]?.want));
  check('both gates name the same condition', first?.gates?.[0]?.conditionId === second?.gates?.[0]?.conditionId, first?.gates?.[0]?.conditionId);
  check('the gate records the comparison, not just a side', first?.gates?.[0]?.field === 'pipeline_stage' && first?.gates?.[0]?.operator === 'equals');
}

// ── 3. the predicate discriminates ──────────────────────────────────────────
head('3. the predicate separates one lead shape from another');
{
  check('>= normalises', normaliseOperator('>=') === 'greater_or_equal');
  check('== normalises', normaliseOperator('==') === 'equals');
  check('Contains normalises', normaliseOperator('Contains') === 'contains');
  const cond = readCondition({ id: 'c1', title: 'New lead?', config: { field: 'pipeline_stage', operator: '==', value: 'New Lead' } });
  const onTrue = evaluateGates([gateFor(cond, true)], { pipeline_stage: 'New Lead' });
  const onFalse = evaluateGates([gateFor(cond, false)], { pipeline_stage: 'Contacted' });
  check('a New Lead satisfies the TRUE side', onTrue.ok, onTrue.detail.slice(0, 80));
  check('a Contacted lead satisfies the FALSE side', onFalse.ok, onFalse.detail.slice(0, 80));
  check('and a New Lead does NOT satisfy the FALSE side', !evaluateGates([gateFor(cond, false)], { pipeline_stage: 'New Lead' }).ok);

  const budget = readCondition({
    id: 'c2',
    title: 'Big budget?',
    config: { field: 'value', operator: '>=', value: 100000 },
  });
  check('a numeric >= compares as a number', evaluateGates([gateFor(budget, true)], { value: 250000 }).ok);
  check('and refuses the smaller number', !evaluateGates([gateFor(budget, true)], { value: 50000 }).ok);
  check('a numeric string is compared as a number too', evaluateGates([gateFor(budget, true)], { value: '250000' }).ok);

  const json = readCondition({
    id: 'c3',
    title: 'Answered budget',
    config: { field: 'custom_fields.budget', operator: 'contains', value: '2 cr' },
  });
  check('a JSON field is readable by dotted path', evaluateGates([gateFor(json, true)], { custom_fields: { budget: '2 Cr range' } }).ok);

  // Both gates must pass: a step under two conditions.
  const both = [gateFor(cond, true), gateFor(budget, true)];
  check('two gates both have to pass', evaluateGates(both, { pipeline_stage: 'New Lead', value: 250000 }).ok);
  check('one failing gate is enough to exclude the step', !evaluateGates(both, { pipeline_stage: 'New Lead', value: 1 }).ok);
}

// ── 4 & 5. the scheduler ────────────────────────────────────────────────────
head('4. the scheduler runs one side and retires the other');

function fakeStore(steps: ScheduledStep[], leads: Record<string, any> | null) {
  const state = { skipped: [] as { id: string; reason: string }[], executed: [] as string[], claimed: [] as string[] };
  const store: FlowStore = {
    async dueSteps() {
      return steps.filter((s) => !state.skipped.some((k) => k.id === s.id) && !state.executed.includes(s.id) && !state.claimed.includes(s.id));
    },
    async claim(id) {
      state.claimed.push(id);
      return true;
    },
    async complete(id) {
      state.executed.push(id);
    },
    async skip(id, reason) {
      state.skipped.push({ id, reason });
    },
    async hasRun() {
      return false;
    },
    async recordRun() {},
    async lastMessageAtForLead() {
      return null;
    },
    async leadFor(leadId) {
      return leads ? leads[leadId] ?? null : null;
    },
    async isOptedOut() {
      return false;
    },
    async isPaused() {
      return false;
    },
    async isAllPaused() {
      return false;
    },
  };
  return { store, state };
}

const newLeadCond = readCondition({ id: 'c1', title: 'New lead?', config: { field: 'pipeline_stage', operator: '==', value: 'New Lead' } });
const gatedSteps = (leadId: string): ScheduledStep[] => [
  {
    id: `${leadId}_true`,
    flowId: 'flow_1',
    leadId,
    stepIndex: 0,
    kind: 'message',
    runAt: new Date(0).toISOString(),
    status: 'pending',
    attempts: 0,
    runKey: 'accept',
    gates: [gateFor(newLeadCond, true)],
  },
  {
    id: `${leadId}_false`,
    flowId: 'flow_1',
    leadId,
    stepIndex: 1,
    kind: 'message',
    runAt: new Date(0).toISOString(),
    status: 'pending',
    attempts: 0,
    runKey: 'accept',
    gates: [gateFor(newLeadCond, false)],
  },
];

const noon = new Date('2026-11-25T12:00:00Z');
const quiet = { startHour: 21, endHour: 9 };

{
  // Lead A is brand new: the TRUE side runs, the FALSE side is retired.
  const leadA = 'lead_a';
  const a = fakeStore(gatedSteps(leadA), { [leadA]: { id: leadA, pipeline_stage: 'New Lead' } });
  const reportA = await runDueSteps(a.store, noon, {
    quietHours: quiet,
    execute: async (step) => {
      a.state.executed = [...a.state.executed.filter((s) => s !== step.id), step.id];
    },
  });
  check('lead A: the TRUE-branch step ran', reportA.executed.includes(`${leadA}_true`), JSON.stringify(reportA.executed));
  check(
    'lead A: the FALSE-branch step was skipped, by name',
    reportA.skipped.some((s) => s.stepId === `${leadA}_false` && s.reason === 'branch_not_taken'),
    JSON.stringify(reportA.skipped)
  );
  check('lead A: exactly one side ran', reportA.executed.length === 1, String(reportA.executed.length));

  // Lead B is already in conversation: the mirror image.
  const leadB = 'lead_b';
  const b = fakeStore(gatedSteps(leadB), { [leadB]: { id: leadB, pipeline_stage: 'Contacted' } });
  const reportB = await runDueSteps(b.store, noon, {
    quietHours: quiet,
    execute: async (step) => {
      b.state.executed = [...b.state.executed.filter((s) => s !== step.id), step.id];
    },
  });
  check('lead B: the FALSE-branch step ran', reportB.executed.includes(`${leadB}_false`), JSON.stringify(reportB.executed));
  check(
    'lead B: the TRUE-branch step was skipped',
    reportB.skipped.some((s) => s.stepId === `${leadB}_true` && s.reason === 'branch_not_taken'),
    JSON.stringify(reportB.skipped)
  );

  // An ungated step is untouched by any of this.
  const ungated: ScheduledStep[] = [
    { id: 'plain', flowId: 'flow_1', leadId: 'lead_c', stepIndex: 0, kind: 'message', runAt: new Date(0).toISOString(), status: 'pending', attempts: 0 },
  ];
  const c = fakeStore(ungated, { lead_c: { id: 'lead_c', pipeline_stage: 'Anything' } });
  const reportC = await runDueSteps(c.store, noon, { quietHours: quiet, execute: async () => {} });
  check('a step with no gates still runs', reportC.executed.includes('plain'), JSON.stringify(reportC.executed));
}

head('5. an unreadable lead is neither run nor retired');
{
  const leadD = 'lead_d';
  const d = fakeStore(gatedSteps(leadD), {}); // leadFor returns null
  const reportD = await runDueSteps(d.store, noon, { quietHours: quiet, execute: async () => {} });
  check('no side ran', reportD.executed.length === 0, JSON.stringify(reportD.executed));
  check(
    'it is reported as branch_unreadable, not skipped forever',
    reportD.skipped.some((s) => s.reason === 'branch_unreadable') && d.state.skipped.length === 0,
    JSON.stringify(reportD.skipped)
  );

  const noStore: ScheduledStep[] = [
    { id: 'g', flowId: 'flow_1', leadId: 'lead_e', stepIndex: 0, kind: 'message', runAt: new Date(0).toISOString(), status: 'pending', attempts: 0, gates: [gateFor(newLeadCond, true)] },
  ];
  const e = fakeStore(noStore, { lead_e: { pipeline_stage: 'New Lead' } });
  delete (e.store as any).leadFor;
  const reportE = await runDueSteps(e.store, noon, { quietHours: quiet, execute: async () => {} });
  check('a store that cannot evaluate a branch does not run it anyway', reportE.executed.length === 0 && reportE.skipped.some((s) => s.reason === 'branch_unreadable'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
