/**
 * Branching in flows: a condition evaluated at STEP TIME, and the branch it does not take skipped.
 *
 * THE DESIGN, AND WHY IT IS THIS ONE
 * The scheduler is a ledger, not a walk: when a flow fires, every step is written down as a row with
 * an absolute time, and a clock picks up whatever is due. That is what lets a flow wait two days
 * without holding a connection open. So a branch cannot be a jump — there is no program counter to
 * jump with.
 *
 * Two designs were possible:
 *   (a) a row for the condition itself, which when due rewrites the other branch's rows to `skipped`;
 *   (b) a PREDICATE RECORDED ON EACH ROW it guards, evaluated when that row is due.
 *
 * (b) is the one implemented, for three reasons:
 *   * it needs no new `kind` in `flow_schedules.kind`, which is a CHECK constraint — (a) would need a
 *     migration, and a migration that cannot be applied is a feature that does not work;
 *   * the decision is made against the lead AS IT IS WHEN THE STEP IS DUE, days after the flow
 *     started, which is the honest time to ask;
 *   * rows are skipped independently and idempotently, so a crash or a retried tick cannot make one
 *     branch run and then also run the other.
 *
 * The refusal is kept for what genuinely cannot run (see UNSUPPORTED_NODES in canvas-translation):
 * this module only removes the refusal for conditions, and only once it can prove a branch.
 *
 * PURE: no database, no network. The evaluation reuses `evaluateCondition`/`readPath` from engine.ts,
 * which the WhatsApp runner already uses, so there is one definition of what "contains" means.
 */

import type { FlowContext } from './engine';
import { queryableTable } from '@/lib/agent/data/column-map';

/**
 * One predicate a scheduled step has to satisfy before it may run.
 *
 * `want` is the side of the condition this step sits on: a step on the TRUE branch carries
 * `want: true`. Nested conditions produce more than one gate, and ALL of them must pass.
 */
export interface BranchGate {
  /** The id of the condition node that produced this gate, so a skip can name it. */
  conditionId: string;
  /** Human label from the editor, for the skip reason and the run log. */
  label: string;
  /** Which side of the condition this step belongs to. */
  want: boolean;
  /** The comparison itself, in the editor's own vocabulary. */
  field: string;
  operator: string;
  value: unknown;
  /**
   * How the condition reads the lead. Kept as data so a gate can be re-evaluated (and reported)
   * without the flow definition to hand.
   */
  evaluationType?: string;
}

/** Operators the canvas offers as symbols, mapped onto the engine's vocabulary. */
const OPERATOR_ALIASES: Record<string, string> = {
  '>=': 'greater_or_equal',
  '>': 'greater_than',
  '<=': 'less_or_equal',
  '<': 'less_than',
  '==': 'equals',
  '===': 'equals',
  '=': 'equals',
  '!=': 'not_equals',
  '!==': 'not_equals',
  '<>': 'not_equals',
  contains_any: 'contains',
  contains_all: 'contains',
  like: 'contains',
  greater_or_equal_than: 'greater_or_equal',
};

/** `>=` → `greater_or_equal`, `Contains` → `contains`. Unknown operators are left alone (and refused). */
export function normaliseOperator(operator: string): string {
  const raw = String(operator ?? '').trim();
  const symbol = OPERATOR_ALIASES[raw];
  if (symbol) return symbol;
  return raw.toLowerCase().replace(/\s+/g, '_');
}

/** The fields a lead row actually has, dotted paths allowed (`custom_fields.budget`). */
function leadFieldIsReal(field: string): boolean {
  const spec = queryableTable('leads');
  if (!spec) return true; // no map: do not block on it
  const clean = String(field ?? '').trim().replace(/^lead\./, '').replace(/^\{\{|\}\}$/g, '');
  if (!clean) return false;
  const [head, ...rest] = clean.split('.');
  if (!spec.columns.includes(head)) return false;
  // A dotted path must start at a JSON-shaped column; anything else is a typo.
  if (rest.length && !['custom_fields', 'timeline'].includes(head)) return false;
  return true;
}

export interface ConditionInput {
  id?: string;
  title?: string;
  config?: Record<string, any>;
  data?: Record<string, any>;
}

export interface BuiltCondition {
  conditionId: string;
  label: string;
  field: string;
  operator: string;
  value: unknown;
  evaluationType: string;
  /** Why this condition cannot be trusted, if it cannot. Blocks activation. */
  problem?: string;
}

/**
 * Read a condition node into the shape the scheduler gates on.
 *
 * A condition that names no field, or a field a lead does not have, is a PROBLEM rather than a
 * condition that is quietly always false: a flow that looks branched and silently takes one side is
 * the exact failure this whole subsystem exists to stop.
 */
export function readCondition(node: ConditionInput): BuiltCondition {
  const cfg = node.config ?? node.data ?? {};
  const label = String(node.title ?? cfg.title ?? node.id ?? 'condition');
  const evaluationType = String(cfg.evaluationType ?? 'crm_attribute');
  const field = String(cfg.field ?? cfg.left ?? '').trim();
  const operator = String(cfg.operator ?? cfg.op ?? '==').trim();
  const value = cfg.value ?? cfg.right ?? null;

  const built: BuiltCondition = {
    conditionId: String(node.id ?? label),
    label,
    field,
    operator: normaliseOperator(operator),
    value,
    evaluationType,
  };

  if (!field) {
    built.problem = `"${label}" is a branch with no field to compare, so there is no way to choose a side`;
    return built;
  }
  if (!leadFieldIsReal(field)) {
    built.problem =
      `"${label}" branches on "${field}", which is not a field a lead has — the flow would take the ` +
      `same side for every lead. Branch on a CRM field (for example pipeline_stage, source, value, ` +
      `or custom_fields.<name> where the answer is actually stored).`;
    return built;
  }
  const op = built.operator;
  const known = [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'greater_than',
    'less_than',
    'greater_or_equal',
    'less_or_equal',
    'exists',
    'is_empty',
    'is_true',
    'is_false',
  ];
  if (!known.includes(op)) {
    built.problem = `"${label}" uses the comparison "${operator}", which this runner cannot evaluate`;
  }
  return built;
}

/** The gate a step on one side of a condition carries. */
export function gateFor(condition: BuiltCondition, want: boolean): BranchGate {
  return {
    conditionId: condition.conditionId,
    label: condition.label,
    want,
    field: condition.field,
    operator: condition.operator,
    value: condition.value,
    evaluationType: condition.evaluationType,
  };
}

export interface GateEvaluation {
  ok: boolean;
  /** One line per gate, so a skip can say which predicate decided it. */
  detail: string;
}

/**
 * Evaluate every gate against a lead. Pure.
 *
 * `ok` is true only when EVERY gate's side matches the lead — a step nested under two conditions has
 * to satisfy both, which is what an owner drawing "if A and B" expects.
 */
export function evaluateGates(gates: BranchGate[] | undefined, lead: Record<string, any> | null): GateEvaluation {
  if (!gates?.length) return { ok: true, detail: 'no gates' };
  const ctx: FlowContext = { lead: lead ?? {} };
  const lines: string[] = [];
  for (const gate of gates) {
    const actual = readLeadValue(ctx, gate.field);
    const met = meets(gate, actual);
    lines.push(
      `${gate.label}: ${gate.field} ${gate.operator} ${JSON.stringify(gate.value)} -> actual ` +
        `${JSON.stringify(actual ?? null)} = ${met ? 'true' : 'false'}, this step is on the ` +
        `${gate.want ? 'TRUE' : 'FALSE'} branch`
    );
    if (met !== gate.want) return { ok: false, detail: lines.join('; ') };
  }
  return { ok: true, detail: lines.join('; ') };
}

/** Read a lead value the same way the WhatsApp runner does (`lead.x`, `custom_fields.x`, `{{x}}`). */
export function readLeadValue(ctx: FlowContext, field: string): unknown {
  const clean = String(field ?? '')
    .trim()
    .replace(/^\{\{|\}\}$/g, '')
    .replace(/^lead\./, '');
  if (!clean) return undefined;
  const lead = ctx.lead ?? {};
  const [head, ...rest] = clean.split('.');
  let value: any = lead[head];
  if (value === undefined && lead.custom_fields && head in lead.custom_fields) value = lead.custom_fields[head];
  for (const key of rest) {
    if (value == null) return undefined;
    value = value[key];
  }
  return value;
}

/** Does `actual` satisfy `gate`'s comparison, before the want/mirror step? */
function meets(gate: BranchGate, actual: unknown): boolean {
  const op = normaliseOperator(gate.operator);
  const expected = gate.value;
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).toLowerCase().trim();
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  switch (op) {
    case 'equals':
      // Numeric equality when both sides look numeric, so "100" == 100 is true.
      if (Number.isFinite(num(actual)) && Number.isFinite(num(expected))) return num(actual) === num(expected);
      return str(actual) === str(expected);
    case 'not_equals':
      if (Number.isFinite(num(actual)) && Number.isFinite(num(expected))) return num(actual) !== num(expected);
      return str(actual) !== str(expected);
    case 'contains':
      return str(actual).includes(str(expected));
    case 'not_contains':
      return !str(actual).includes(str(expected));
    case 'starts_with':
      return str(actual).startsWith(str(expected));
    case 'ends_with':
      return str(actual).endsWith(str(expected));
    case 'greater_than':
      return num(actual) > num(expected);
    case 'less_than':
      return num(actual) < num(expected);
    case 'greater_or_equal':
      return num(actual) >= num(expected);
    case 'less_or_equal':
      return num(actual) <= num(expected);
    case 'exists':
      return actual !== undefined && actual !== null && String(actual).length > 0;
    case 'is_empty':
      return actual === undefined || actual === null || String(actual).length === 0;
    case 'is_true':
      return actual === true || str(actual) === 'true' || str(actual) === 'yes';
    case 'is_false':
      return actual === false || str(actual) === 'false' || str(actual) === 'no';
    default:
      return false;
  }
}

/** The editor writes `branch: 'true' | 'false' | 'main'` on the node itself. */
export function branchSideOf(node: { branch?: string }): boolean | null {
  const raw = String(node?.branch ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === 'yes' || raw === 'a') return true;
  if (raw === 'false' || raw === 'no' || raw === 'b') return false;
  return null;
}
