/**
 * Flow execution engine: branch-aware traversal and condition evaluation.
 *
 * The old traversal was a handle-blind BFS from the trigger. It followed EVERY
 * outgoing edge, so a "Condition" node's true AND false branches both ran, and
 * "Qualify" could not influence anything. That made the two most-used editor
 * nodes decorative: a flow could look like it branched while every downstream
 * step fired regardless.
 *
 * This module resolves an execution PLAN: an ordered list of nodes to run, with
 * condition and split nodes deciding which side is reachable at all. The
 * WhatsApp runner then executes the plan.
 *
 * Design rules:
 *  - Deterministic. Same lead + same answers always yields the same branch.
 *  - Never throw on bad config. A malformed condition is treated as "not met"
 *    and reported, so one bad node cannot take the whole flow down.
 *  - Pure. No network, no database — callers pass what they know.
 */

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'exists'
  | 'is_empty'
  | 'is_true'
  | 'is_false';

export interface FlowContext {
  /** Raw inbound text that fired the flow. */
  messageText?: string;
  /** Button / quick-reply title that was tapped. */
  buttonReplyTitle?: string;
  lead?: Record<string, any>;
  chat?: Record<string, any>;
  /** Collected question answers, keyed by question id/label. */
  answers?: Record<string, string>;
  /** Score produced by a previous qualify node (0-100). */
  qualificationScore?: number;
}

/** Resolve a dotted path like `lead.pipeline_stage` or `answers.budget`. */
export function readPath(ctx: FlowContext, path: string): any {
  if (!path) return undefined;
  const clean = path.replace(/^\{\{|\}\}$/g, '').trim();
  const roots: Record<string, any> = {
    lead: ctx.lead,
    chat: ctx.chat,
    answers: ctx.answers,
    message_text: ctx.messageText,
    messageText: ctx.messageText,
    button_title: ctx.buttonReplyTitle,
    qualification_score: ctx.qualificationScore,
    score: ctx.qualificationScore,
  };
  const [head, ...rest] = clean.split('.');
  let value = roots[head];
  if (value === undefined && ctx.lead && head in ctx.lead) value = ctx.lead[head];
  if (value === undefined && ctx.lead?.custom_fields && head in ctx.lead.custom_fields) {
    value = ctx.lead.custom_fields[head];
  }
  for (const key of rest) {
    if (value == null) return undefined;
    value = value[key];
  }
  return value;
}

/** Evaluate one condition. Malformed config returns `{ met: false, error }`. */
export function evaluateCondition(
  config: Record<string, any>,
  ctx: FlowContext
): { met: boolean; error?: string; actual?: any } {
  const field = String(config.field || config.left || '').trim();
  const operator = String(config.operator || config.op || 'contains').toLowerCase().replace(/\s+/g, '_') as ConditionOperator;
  const expected = config.value ?? config.right ?? '';

  if (!field) return { met: false, error: 'condition has no field' };

  const actual = readPath(ctx, field);

  const num = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const str = (v: any) => (v === null || v === undefined ? '' : String(v)).toLowerCase();
  const expectedStr = str(expected);

  switch (operator) {
    case 'equals':
      return { met: str(actual) === expectedStr, actual };
    case 'not_equals':
      return { met: str(actual) !== expectedStr, actual };
    case 'contains':
      return { met: str(actual).includes(expectedStr), actual };
    case 'not_contains':
      return { met: !str(actual).includes(expectedStr), actual };
    case 'starts_with':
      return { met: str(actual).startsWith(expectedStr), actual };
    case 'ends_with':
      return { met: str(actual).endsWith(expectedStr), actual };
    case 'greater_than':
      return { met: num(actual) > num(expected), actual };
    case 'less_than':
      return { met: num(actual) < num(expected), actual };
    case 'exists':
      return { met: actual !== undefined && actual !== null && String(actual).length > 0, actual };
    case 'is_empty':
      return { met: actual === undefined || actual === null || String(actual).length === 0, actual };
    case 'is_true':
      return { met: actual === true || str(actual) === 'true' || str(actual) === 'yes', actual };
    case 'is_false':
      return { met: actual === false || str(actual) === 'false' || str(actual) === 'no', actual };
    default:
      return { met: false, error: `unknown operator "${operator}"`, actual };
  }
}

/**
 * Score a lead from a qualify node.
 *
 * Every configured question contributes equally; an answer counts as positive
 * when it matches one of the question's `passValues` (or, if none are given,
 * any non-empty answer that is not an obvious "no"). Deliberately simple and
 * explainable — the score is shown to the user, so it must be predictable.
 */
export function scoreQualification(
  config: Record<string, any>,
  ctx: FlowContext
): { score: number; passed: boolean; detail: string[] } {
  const passScore = Number(config.passScore ?? config.threshold ?? 70);
  const questions: any[] = Array.isArray(config.questions) ? config.questions : [];
  const detail: string[] = [];

  if (questions.length === 0) {
    // No question config: fall back to the inbound text.
    const positive = /\b(yes|interested|visit|book|buy|price|brochure|call me)\b/i.test(ctx.messageText || '');
    const score = positive ? 100 : 0;
    detail.push(`no questions configured; inbound text looks ${positive ? 'positive' : 'neutral'}`);
    return { score, passed: score >= passScore, detail };
  }

  let hits = 0;
  for (const q of questions) {
    const key = String(q.id || q.label || q.key || '');
    const answer = String(ctx.answers?.[key] ?? readPath(ctx, `answers.${key}`) ?? '');
    const passValues: string[] = (Array.isArray(q.passValues) ? q.passValues : q.passValue ? [q.passValue] : []).map((v: any) => String(v).toLowerCase());
    const negatives = /^(no|none|not interested|later|nope|n)$/i;

    let ok: boolean;
    if (passValues.length > 0) ok = passValues.some((v) => answer.toLowerCase().includes(v));
    else ok = answer.trim().length > 0 && !negatives.test(answer.trim());

    if (ok) hits += 1;
    detail.push(`${key || 'question'}: "${answer.slice(0, 40)}" -> ${ok ? 'pass' : 'fail'}`);
  }

  const score = Math.round((hits / questions.length) * 100);
  return { score, passed: score >= passScore, detail };
}

/**
 * Deterministic A/B split. Same lead always lands on the same side so a
 * prospect never sees both variants.
 */
export function splitBucket(leadId: string | undefined, percentA: number): 'a' | 'b' {
  let hash = 0;
  const s = String(leadId || 'anon');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 100000;
  return hash % 100 < Math.max(0, Math.min(100, percentA)) ? 'a' : 'b';
}

export interface PlanInput {
  nodes: any[];
  edges: any[];
  /** Where traversal starts: the trigger node, or explicit starting node ids. */
  startNodeIds?: string[];
  ctx: FlowContext;
}

export interface PlanStep {
  node: any;
  /** Which branch handle led here, when it came from a condition or split. */
  viaHandle?: string;
}

export interface PlanResult {
  steps: PlanStep[];
  /** Condition/split decisions, for the run log. */
  decisions: { nodeId: string; nodeType: string; handle: string; reason: string }[];
  /** Config problems found while planning. */
  problems: string[];
}

const CONDITION_TYPES = new Set(['action_condition', 'conditionNode', 'condition', 'action_if_else']);
const QUALIFY_TYPES = new Set(['action_qualify', 'qualifyNode', 'action_qualification']);
const SPLIT_TYPES = new Set(['action_split_traffic', 'splitNode', 'action_ab_split']);

/** Which outgoing handle a condition picks. */
function conditionHandle(node: any, ctx: FlowContext, problems: string[]): { handle: string; reason: string } {
  const cfg = node?.data || node?.config || {};
  const { met, error, actual } = evaluateCondition(cfg, ctx);
  if (error) problems.push(`condition ${node?.id || '?'}: ${error} — treated as not met`);
  const trueHandle = String(cfg.trueHandle || cfg.yesHandle || 'true').toLowerCase();
  const falseHandle = String(cfg.falseHandle || cfg.noHandle || 'false').toLowerCase();
  return {
    handle: met ? trueHandle : falseHandle,
    reason: `${cfg.field ?? '?'} ${cfg.operator ?? 'contains'} ${JSON.stringify(cfg.value ?? '')} -> actual ${JSON.stringify(actual)} => ${met ? 'true' : 'false'}`,
  };
}

/** Handles that should be followed for a node that is not a decision point. */
function outgoingFor(edges: any[], nodeId: string): any[] {
  return edges.filter((e) => e.source === nodeId);
}

/**
 * Resolve the ordered run plan.
 *
 * Walks breadth-first from the start, but at a decision node only enqueues the
 * targets reachable through the chosen handle. Nodes are de-duplicated, so a
 * diamond rejoins rather than running twice.
 */
export function resolveExecutionPlan(input: PlanInput): PlanResult {
  const { nodes, edges, ctx } = input;
  const decisions: PlanResult['decisions'] = [];
  const problems: string[] = [];
  const steps: PlanStep[] = [];

  if (nodes.length === 0) return { steps, decisions, problems: ['flow has no nodes'] };

  const byId = new Map<string, any>();
  for (const n of nodes) if (n?.id) byId.set(String(n.id), n);

  const trigger = nodes.find((n) => n.type === 'triggerNode' || String(n.type || '').startsWith('trigger_'));
  let starts: string[] = input.startNodeIds?.filter(Boolean) || [];

  if (starts.length === 0 && trigger && edges.length > 0) {
    starts = outgoingFor(edges, String(trigger.id)).map((e) => String(e.target)).filter(Boolean);
  }
  if (starts.length === 0) {
    // No wiring at all: fall back to the declared order so old flows still run.
    steps.push(...nodes.filter((n) => n !== trigger).map((node) => ({ node })));
    if (edges.length === 0) problems.push('flow has no edges; executed nodes in declaration order');
    return { steps, decisions, problems };
  }

  const queue: string[] = [...starts];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const node = byId.get(id);
    if (!node) {
      problems.push(`edge points at missing node ${id}`);
      continue;
    }

    const type = String(node.type || '');
    const outs = outgoingFor(edges, id);

    if (CONDITION_TYPES.has(type)) {
      const { handle, reason } = conditionHandle(node, ctx, problems);
      decisions.push({ nodeId: id, nodeType: type, handle, reason });
      // Follow only edges whose sourceHandle matches the decision. Edges with no
      // handle are treated as the default path so simple chains still work.
      const matched = outs.filter((e) => {
        const h = String(e.sourceHandle || '').toLowerCase();
        if (!h) return handle === 'true' ? outs.length === 1 || e === outs[0] : false;
        return h === handle || h.replace(/[^a-z]/g, '') === handle;
      });
      if (matched.length === 0) {
        problems.push(`condition ${id}: no edge for branch "${handle}"`);
      }
      for (const e of matched) queue.push(String(e.target));
      continue; // the condition node itself has no side effect
    }

    if (SPLIT_TYPES.has(type)) {
      const cfg = node.data || node.config || {};
      const bucket = splitBucket(ctx.lead?.id, Number(cfg.percentA ?? cfg.splitPercent ?? 50));
      decisions.push({ nodeId: id, nodeType: type, handle: bucket, reason: `bucket ${bucket}` });
      const matched = outs.filter((e) => {
        const h = String(e.sourceHandle || '').toLowerCase();
        return !h || h === bucket || h.includes(bucket);
      });
      for (const e of matched) queue.push(String(e.target));
      continue;
    }

    if (QUALIFY_TYPES.has(type)) {
      const cfg = node.data || node.config || {};
      const result = scoreQualification(cfg, ctx);
      ctx.qualificationScore = result.score;
      decisions.push({
        nodeId: id,
        nodeType: type,
        handle: result.passed ? 'passed' : 'failed',
        reason: `score ${result.score} vs pass ${Number(cfg.passScore ?? cfg.threshold ?? 70)} (${result.detail.join('; ') || 'no detail'})`,
      });
      // A qualify node may also route; if it has no conditional handles, fall through.
      const conditional = outs.filter((e) => {
        const h = String(e.sourceHandle || '').toLowerCase();
        return h === 'passed' || h === 'failed' || h === 'true' || h === 'false';
      });
      const next = conditional.length > 0
        ? conditional.filter((e) => {
            const h = String(e.sourceHandle || '').toLowerCase();
            return result.passed ? h === 'passed' || h === 'true' : h === 'failed' || h === 'false';
          })
        : outs;
      for (const e of next) queue.push(String(e.target));
    }

    steps.push({ node });

    for (const e of outs) {
      if (CONDITION_TYPES.has(type) || SPLIT_TYPES.has(type) || QUALIFY_TYPES.has(type)) continue;
      queue.push(String(e.target));
    }
  }

  return { steps, decisions, problems };
}
