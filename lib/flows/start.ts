import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_QUIET_HOURS, scheduleFor, type InternalAction, type PlannedAction, type QuietHours } from './scheduling';
import { enqueueFlowRun, quietHoursFor, type EnqueueKind } from './store';
import { TRIGGER_CAPABILITIES, validateAgainstTrigger } from './capabilities';

/**
 * Starting a flow.
 *
 * A flow created by the agent is an `automations` row whose description holds
 * `{ name, trigger: { type }, nodes: [...] }`. Until now nothing turned that into work: the builder
 * could save a flow and no event ever walked it. This module is the executor's front half — it reads
 * the stored shape, refuses anything the trigger cannot support, and writes the steps into the
 * ledger with absolute times so the clock picks them up.
 *
 * It is deliberately separate from the send path. Starting a flow costs nothing and messages nobody;
 * the clock decides what actually goes out, under the gates in scheduling.ts, and a human decides
 * whether each step is sent at all (lib/flows/delivery.ts).
 *
 * TWO THINGS THE STORED SHAPE DOES NOT ALWAYS CARRY
 *   1. The trigger. Seven flows on real accounts record none, and the honest answer is not to guess
 *      one from the flow's prose — it is to let the EVENT that is firing declare itself. A flow with
 *      no trigger can therefore still run when an inbound message starts it, and is still refused
 *      when nothing does.
 *   2. Which run it is. `runKey` comes from the event ('inbound:<message id>'), so a genuinely new
 *      message starts a new run while a replayed webhook cannot. A flow that should only ever fire
 *      once per lead keeps the default 'once'.
 */

export interface StoredFlowNode {
  type?: string;
  data?: {
    message?: string;
    body?: string;
    description?: string;
    prompt?: string;
    seconds?: number;
    duration?: number;
    templateName?: string;
    buttons?: { id?: string; title?: string; text?: string }[] | string[];
    triggerType?: string;
    agent?: string;
    assignAgent?: string;
    note?: string;
  };
}

export interface PlannedFlowStep extends PlannedAction {
  text?: string;
  templateName?: string | null;
  /** Quick-reply buttons, which turn a free-form send into an interactive message. */
  buttons?: { id: string; title: string }[];
  /** An AI step in front of this action: the text is written at approval time, not before it. */
  compose?: { prompt: string };
}

export interface StoredTrigger {
  type: string;
  keywords: string[];
  keyword: string | null;
  templateName: string | null;
  buttonId: string | null;
}

/** Read the trigger out of a stored flow description, without guessing one that is absent. */
export function storedTrigger(description: string | null | undefined): StoredTrigger | null {
  const parsed = parseDescription(description);
  if (!parsed) return null;
  const raw = parsed.trigger ?? {};
  const type = raw.type ? String(raw.type) : null;
  if (!type) return null;
  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords.map((k: any) => String(k)).filter(Boolean)
    : raw.keywords
      ? [String(raw.keywords)]
      : [];
  return {
    type,
    keywords,
    keyword: raw.keyword ? String(raw.keyword) : null,
    templateName: raw.templateName ? String(raw.templateName) : null,
    buttonId: raw.button_id ? String(raw.button_id) : raw.buttonId ? String(raw.buttonId) : null,
  };
}

function parseDescription(description: string | null | undefined): any | null {
  try {
    const raw = String(description ?? '');
    const brace = raw.indexOf('{');
    if (brace < 0) return null;
    return JSON.parse(raw.slice(brace));
  } catch {
    return null;
  }
}

function buttonsFrom(raw: unknown): { id: string; title: string }[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const buttons = raw
    .slice(0, 3)
    .map((b: any, i: number) => {
      const title = String(b?.title ?? b?.text ?? b ?? '').trim();
      if (!title) return null;
      return { id: String(b?.id ?? `flow_btn_${i}`).slice(0, 256), title: title.slice(0, 20) };
    })
    .filter(Boolean) as { id: string; title: string }[];
  return buttons.length ? buttons : undefined;
}

/**
 * Read the actions out of a stored flow description.
 *
 * A node the scheduler cannot execute is reported as a problem rather than skipped, because a flow
 * that silently drops a step is the failure mode this whole module exists to prevent.
 */
export function planFromFlowDescription(description: string | null | undefined): {
  actions: PlannedFlowStep[];
  triggerType: string | null;
  templateName: string | null;
  problems: string[];
} {
  const problems: string[] = [];
  const parsed = parseDescription(description);
  if (!parsed) {
    problems.push('the flow description is not readable JSON, so its steps cannot be recovered');
    return { actions: [], triggerType: null, templateName: null, problems };
  }

  const triggerType = parsed.trigger?.type ? String(parsed.trigger.type) : null;
  const templateName = parsed.trigger?.templateName ? String(parsed.trigger.templateName) : null;
  const nodes: StoredFlowNode[] = Array.isArray(parsed.nodes) ? parsed.nodes : [];

  const actions: PlannedFlowStep[] = [];
  /** An AI step writes the copy for the action that follows it. */
  let pendingCompose: { prompt: string } | null = null;

  const attach = (step: PlannedFlowStep) => {
    if (pendingCompose) {
      step.compose = pendingCompose;
      pendingCompose = null;
    }
    actions.push(step);
  };

  for (const node of nodes) {
    const type = String(node?.type ?? '');
    const data = node?.data ?? {};

    if (type === 'triggerNode') continue;

    if (type === 'whatsappMessageNode' || type === 'action_whatsapp_msg' || type === 'action_send_whatsapp' || type === 'inventoryDeliveryNode') {
      const text = String(data.message ?? data.body ?? '').trim();
      const tpl = data.templateName ? String(data.templateName) : null;
      if (!text && !tpl) {
        problems.push('a message step has no text');
        continue;
      }
      attach({ kind: 'message', text, templateName: tpl });
      continue;
    }

    if (type === 'action_whatsapp_interactive') {
      const text = String(data.message ?? data.body ?? '').trim();
      if (!text) {
        problems.push('an interactive WhatsApp step has no body text');
        continue;
      }
      const buttons = buttonsFrom(data.buttons);
      if (!buttons) {
        problems.push('an interactive WhatsApp step has no buttons, so it is just a plain message');
        attach({ kind: 'message', text, templateName: data.templateName ? String(data.templateName) : null });
        continue;
      }
      attach({ kind: 'message', text, templateName: data.templateName ? String(data.templateName) : null, buttons });
      continue;
    }

    if (type === 'aiCallNode' || type === 'action_ai_call') {
      attach({ kind: 'call', text: String(data.description ?? data.message ?? '').trim() || undefined });
      continue;
    }

    if (type === 'delayNode' || type === 'action_delay') {
      const seconds = Number(data.seconds ?? data.duration ?? 0);
      if (Number.isFinite(seconds) && seconds > 0) actions.push({ kind: 'wait', seconds });
      continue;
    }

    // ── the three nodes that used to be "unsupported" ──────────────────────
    if (type === 'ai_deepseek' || type === 'aiStepNode') {
      const prompt = String(data.prompt ?? data.description ?? data.message ?? '').trim();
      if (!prompt) {
        // An AI step with no instruction cannot write anything; saying so beats sending a blank.
        problems.push('an AI step has no instruction, so it would write nothing');
        continue;
      }
      pendingCompose = { prompt };
      continue;
    }

    if (type === 'action_ai_call_transfer') {
      const agent = String(data.agent ?? data.assignAgent ?? '').trim();
      const internal: InternalAction = agent ? { kind: 'assign', value: agent } : { kind: 'note', value: String(data.note ?? 'A human needs to take this conversation over.').trim() };
      actions.push({ kind: 'handoff', internal });
      continue;
    }

    // A node type the scheduler does not walk. Loud, not silent.
    if (type) problems.push(`"${type}" is not a step the scheduler can run, so it would be skipped`);
  }

  if (pendingCompose) {
    problems.push('an AI step has nothing after it, so the text it writes is never used');
  }
  if (!actions.some((a) => a.kind !== 'wait')) {
    problems.push('the flow has waits but no message or call to perform');
  }
  return { actions, triggerType, templateName, problems };
}

export interface StartResult {
  ok: boolean;
  queued: number;
  firstRunAt?: string;
  blockers: string[];
  /** Machine-readable reason, so a caller can tell "refused" from "already queued". */
  reason?: 'no_trigger' | 'unknown_trigger' | 'infeasible' | 'nothing_to_do' | 'already_queued';
  /** The trigger this run actually used — the stored one, or the event's. */
  triggerType?: string | null;
  runKey?: string;
}

/**
 * Start one run of a flow for one lead: validate against the trigger's identity, then write the
 * steps into the ledger. Nothing is sent here and nothing can be sent ahead of its time.
 */
export async function startFlowRun(
  supabase: SupabaseClient,
  input: {
    userId: string;
    flowId: string;
    leadId: string;
    description: string | null | undefined;
    now?: Date;
    quietHours?: QuietHours;
    /**
     * The event that is starting this run. Used when the flow itself records no trigger — the
     * alternative was guessing from the flow's prose, which is how two flows ended up "on the same
     * trigger" while describing it differently.
     */
    triggerType?: string | null;
    /** Which run this is. Defaults to 'once' — a flow that fires once per lead for ever. */
    runKey?: string;
  }
): Promise<StartResult> {
  const now = input.now ?? new Date();
  const runKey = (input.runKey || 'once').slice(0, 120);
  const quiet = input.quietHours ?? (await quietHoursFor(supabase, input.userId)) ?? DEFAULT_QUIET_HOURS;
  const plan = planFromFlowDescription(input.description);

  const triggerType = plan.triggerType ?? input.triggerType ?? null;
  if (!triggerType) {
    return {
      ok: false,
      queued: 0,
      blockers: ['the flow does not record which event starts it'],
      reason: 'no_trigger',
      runKey,
    };
  }
  if (!TRIGGER_CAPABILITIES[triggerType]) {
    return {
      ok: false,
      queued: 0,
      blockers: [`"${triggerType}" is not an event this system fires on`],
      reason: 'unknown_trigger',
      triggerType,
      runKey,
    };
  }

  // Waits are not actions: they need no identity from the trigger, so they are excluded from the
  // feasibility check (a flow is otherwise refused for containing a perfectly normal delay).
  const identityBlockers = validateAgainstTrigger(
    triggerType,
    plan.actions.filter((a) => a.kind !== 'wait' && a.kind !== 'handoff').map((a) => a.kind)
  ).map((b) => b.message);

  const blockers = [...plan.problems, ...identityBlockers];
  if (blockers.length) return { ok: false, queued: 0, blockers, reason: 'infeasible', triggerType, runKey };

  const scheduled = scheduleFor(input.flowId, input.leadId, plan.actions, now, quiet, runKey);
  if (!scheduled.length) {
    return { ok: false, queued: 0, blockers: ['the flow has nothing to run'], reason: 'nothing_to_do', triggerType, runKey };
  }

  const keyed = scheduled.map((row) => {
    const action = plan.actions[row.stepIndex];
    return {
      stepIndex: row.stepIndex,
      kind: (row.kind === 'call' ? 'call' : row.kind === 'handoff' ? 'handoff' : 'message') as EnqueueKind,
      runAt: row.runAt,
      runKey,
      payload: {
        text: action?.text ?? null,
        templateName: action?.templateName ?? null,
        buttons: action?.buttons ?? null,
        compose: action?.compose ?? null,
        internal: action?.internal ?? null,
        trigger: triggerType,
      },
    };
  });

  const { queued } = await enqueueFlowRun(supabase, input.userId, input.flowId, input.leadId, keyed, runKey);
  if (queued === 0) {
    // Not an error: this exact run already wrote its steps (a replayed webhook). Saying so keeps
    // the difference between "refused" and "already done" visible to whoever is testing.
    return {
      ok: true,
      queued: 0,
      firstRunAt: keyed[0]?.runAt.toISOString(),
      blockers: [],
      reason: 'already_queued',
      triggerType,
      runKey,
    };
  }
  return { ok: true, queued, firstRunAt: keyed[0]?.runAt.toISOString(), blockers: [], triggerType, runKey };
}
