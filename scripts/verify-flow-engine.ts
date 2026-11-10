/**
 * Proves the flow engine actually branches.
 *
 * The bug this guards against: the old traversal followed EVERY outgoing edge,
 * so both sides of a condition ran and a "Qualify" node could not affect
 * anything. A flow looked like it branched and behaved like a straight line.
 *
 *   npm run verify:flow-engine
 */
import { resolveExecutionPlan, evaluateCondition, scoreQualification, splitBucket } from '../lib/flows/engine';
import { validateFlow } from '../lib/flows/schema';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const types = (plan: any) => plan.steps.map((s: any) => s.node.type);

// ── a condition that routes yes / no ────────────────────────────────────────
const graph = {
  nodes: [
    { id: 't', type: 'triggerNode', data: { triggerType: 'whatsapp_inbound' } },
    { id: 'c', type: 'action_condition', data: { field: 'message_text', operator: 'contains', value: 'price' } },
    { id: 'yes', type: 'action_whatsapp_msg', data: { message: 'sending prices' } },
    { id: 'no', type: 'action_whatsapp_msg', data: { message: 'anything else?' } },
  ],
  edges: [
    { source: 't', target: 'c' },
    { source: 'c', target: 'yes', sourceHandle: 'true' },
    { source: 'c', target: 'no', sourceHandle: 'false' },
  ],
};

const yesPlan = resolveExecutionPlan({ ...graph, ctx: { messageText: 'what is the price?' } });
check('condition TRUE runs exactly one branch', yesPlan.steps.length === 1, `ran ${yesPlan.steps.length} node(s)`);
check('condition TRUE picked handle true', yesPlan.decisions[0]?.handle === 'true', yesPlan.decisions[0]?.reason);
check('true branch is the "sending prices" node', yesPlan.steps[0]?.node.id === 'yes', yesPlan.steps[0]?.node.id);

const noPlan = resolveExecutionPlan({ ...graph, ctx: { messageText: 'hello there' } });
check('condition FALSE runs only the false branch', noPlan.steps.length === 1 && noPlan.steps[0]?.node.id === 'no', noPlan.steps[0]?.node.id);
check('the two branches genuinely diverge', yesPlan.steps[0]?.node.id !== noPlan.steps[0]?.node.id);

// ── qualify gates the branch ───────────────────────────────────────────────
const qGraph = {
  nodes: [
    { id: 't', type: 'triggerNode' },
    { id: 'q', type: 'action_qualify', data: { passScore: 70, questions: [{ id: 'budget', passValues: ['yes', '50l', '1cr'] }] } },
    { id: 'pass', type: 'notifyNode', data: { title: 'hot lead' } },
    { id: 'drop', type: 'tagNode', data: { tag: 'cold' } },
  ],
  edges: [
    { source: 't', target: 'q' },
    { source: 'q', target: 'pass', sourceHandle: 'passed' },
    { source: 'q', target: 'drop', sourceHandle: 'failed' },
  ],
};
const hot = resolveExecutionPlan({ ...qGraph, ctx: { answers: { budget: 'yes' } } });
const cold = resolveExecutionPlan({ ...qGraph, ctx: { answers: { budget: 'no' } } });
check('qualified lead reaches the hot path', hot.steps.map((s: any) => s.node.id).includes('pass'), hot.decisions[0]?.reason);
check('unqualified lead reaches the drop path', cold.steps.map((s: any) => s.node.id).includes('drop'), cold.decisions[0]?.reason);
check('unqualified lead does NOT reach the hot path', !cold.steps.map((s: any) => s.node.id).includes('pass'));

// ── scoring is explainable ─────────────────────────────────────────────────
const scored = scoreQualification({ passScore: 70, questions: [{ id: 'a' }, { id: 'b' }] }, { answers: { a: 'yes', b: 'no' } });
check('score is a percentage of passing answers', scored.score === 50, `score=${scored.score}`);
check('score explains itself', scored.detail.length === 2, scored.detail.join(' | ').slice(0, 70));

// ── operators ──────────────────────────────────────────────────────────────
check('greater_than compares numerically', evaluateCondition({ field: 'qualification_score', operator: 'greater_than', value: 70 }, { qualificationScore: 85 }).met);
check('is_empty detects blank lead fields', evaluateCondition({ field: 'lead.budget', operator: 'is_empty' }, { lead: {} }).met);
check('malformed condition fails closed', evaluateCondition({ operator: 'contains', value: 'x' }, {}).error !== undefined);

// ── deterministic A/B ──────────────────────────────────────────────────────
const a1 = splitBucket('lead-123', 50);
const a2 = splitBucket('lead-123', 50);
check('split is deterministic per lead', a1 === a2, a1);

// ── a diamond rejoins without double-running ───────────────────────────────
const diamond = {
  nodes: [
    { id: 't', type: 'triggerNode' },
    { id: 'c', type: 'action_condition', data: { field: 'lead.stage', operator: 'equals', value: 'New' } },
    { id: 'x', type: 'tagNode', data: { tag: 'seen' } },
    { id: 'y', type: 'crmStageNode', data: { stage: 'Contacted' } },
    { id: 'z', type: 'notifyNode', data: { title: 'done' } },
  ],
  edges: [
    { source: 't', target: 'c' },
    { source: 'c', target: 'x', sourceHandle: 'true' },
    { source: 'c', target: 'y', sourceHandle: 'false' },
    { source: 'x', target: 'z' },
    { source: 'y', target: 'z' },
  ],
};
const d = resolveExecutionPlan({ ...diamond, ctx: { lead: { stage: 'New' } } });
check('rejoining node runs exactly once', d.steps.filter((s: any) => s.node.id === 'z').length === 1, `${d.steps.length} steps`);
check('only the taken branch is executed', !d.steps.map((s: any) => s.node.id).includes('y'));

// ── validate-on-publish gate ───────────────────────────────────────────────
const goodFlow = validateFlow({ nodes: [
  { id: 't', type: 'triggerNode', data: { triggerType: 'whatsapp_inbound' } },
  { id: 'm', type: 'action_whatsapp_msg', data: { message: 'hi' } },
], edges: [{ source: 't', target: 'm' }] });
check('a valid flow passes validation', goodFlow.ok === true, goodFlow.issues.map((i: any) => i.message).join('; '));

const deadNode = validateFlow({ nodes: [
  { id: 't', type: 'triggerNode' },
  { id: 'q', type: 'action_whatsapp_questions', data: {} },
], edges: [{ source: 't', target: 'q' }] });
check('an unsupported node blocks publishing', deadNode.ok === false);
check('and names the offending node', deadNode.issues.some((i: any) => /Question|not implemented/i.test(i.message)),
  deadNode.issues.find((i: any) => i.severity === 'error')?.message?.slice(0, 80));

const noTrigger = validateFlow({ nodes: [{ id: 'm', type: 'action_whatsapp_msg', data: {} }], edges: [] });
check('a flow with no trigger is rejected', noTrigger.ok === false && noTrigger.issues.some((i: any) => /No trigger/i.test(i.message)));

const noAction = validateFlow({ nodes: [{ id: 't', type: 'triggerNode' }], edges: [] });
check('a flow with no action is rejected', noAction.ok === false && noAction.issues.some((i: any) => /No executable action/i.test(i.message)));

const longDelay = validateFlow({ nodes: [
  { id: 't', type: 'triggerNode' },
  { id: 'd', type: 'action_delay', data: { seconds: 7200 } },
], edges: [{ source: 't', target: 'd' }] });
check('a 2 hour delay warns about the 10s cap', longDelay.issues.some((i: any) => i.severity === 'warning' && /capped to 10s/i.test(i.message)),
  longDelay.issues.find((i: any) => i.severity === 'warning')?.message?.slice(0, 70));
console.log(`\n=== ${fails === 0 ? 'all checks passed' : fails + ' FAILED'}`);
if (fails) process.exit(1);
