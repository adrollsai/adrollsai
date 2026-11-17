import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_QUIET_HOURS, scheduleFor, type PlannedAction, type QuietHours } from './scheduling';
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
 * the clock decides what actually goes out, under the gates in scheduling.ts.
 */

export interface StoredFlowNode {
  type?: string;
  data?: { message?: string; description?: string; seconds?: number; duration?: number; templateName?: string };
}

export interface PlannedFlowStep extends PlannedAction {
  text?: string;
  templateName?: string | null;
}

/** Read the actions out of a stored flow description. */
export function planFromFlowDescription(description: string | null | undefined): {
  actions: PlannedFlowStep[];
  triggerType: string | null;
  templateName: string | null;
  problems: string[];
} {
  const problems: string[] = [];
  let parsed: any = null;
  try {
    const raw = String(description ?? '');
    const brace = raw.indexOf('{');
    parsed = brace >= 0 ? JSON.parse(raw.slice(brace)) : null;
  } catch {
    problems.push('the flow description is not readable JSON, so its steps cannot be recovered');
    return { actions: [], triggerType: null, templateName: null, problems };
  }
  if (!parsed) {
    problems.push('the flow description is empty');
    return { actions: [], triggerType: null, templateName: null, problems };
  }

  const triggerType = parsed.trigger?.type ? String(parsed.trigger.type) : null;
  const templateName = parsed.trigger?.templateName ? String(parsed.trigger.templateName) : null;
  const nodes: StoredFlowNode[] = Array.isArray(parsed.nodes) ? parsed.nodes : [];

  const actions: PlannedFlowStep[] = [];
  for (const node of nodes) {
    const type = String(node?.type ?? '');
    if (type === 'triggerNode') continue;
    if (type === 'whatsappMessageNode') {
      const text = String(node?.data?.message ?? '').trim();
      if (!text) {
        problems.push('a message step has no text');
        continue;
      }
      actions.push({ kind: 'message', text, templateName: node?.data?.templateName ?? null });
      continue;
    }
    if (type === 'aiCallNode') {
      actions.push({ kind: 'call', text: String(node?.data?.description ?? '').trim() || undefined });
      continue;
    }
    if (type === 'delayNode') {
      const seconds = Number(node?.data?.seconds ?? node?.data?.duration ?? 0);
      if (Number.isFinite(seconds) && seconds > 0) actions.push({ kind: 'wait', seconds });
      continue;
    }
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
  }
): Promise<StartResult> {
  const now = input.now ?? new Date();
  const quiet = input.quietHours ?? (await quietHoursFor(supabase, input.userId)) ?? DEFAULT_QUIET_HOURS;
  const plan = planFromFlowDescription(input.description);

  if (!plan.triggerType) {
    return { ok: false, queued: 0, blockers: ['the flow does not record which event starts it'] };
  }
  if (!TRIGGER_CAPABILITIES[plan.triggerType]) {
    return { ok: false, queued: 0, blockers: [`"${plan.triggerType}" is not an event this system fires on`] };
  }

  const identityBlockers = validateAgainstTrigger(
    plan.triggerType,
    plan.actions.map((a) => a.kind)
  ).map((b) => b.message);

  const blockers = [...plan.problems, ...identityBlockers];
  if (blockers.length) return { ok: false, queued: 0, blockers };

  const scheduled = scheduleFor(input.flowId, input.leadId, plan.actions, now, quiet);
  const keyed = scheduled.map((row) => {
    const action = plan.actions[row.stepIndex];
    return {
      stepIndex: row.stepIndex,
      kind: (row.kind === 'call' ? 'call' : 'message') as EnqueueKind,
      runAt: row.runAt,
      payload: {
        text: action?.text ?? null,
        templateName: action?.templateName ?? null,
        trigger: plan.triggerType,
      },
    };
  });

  const { queued } = await enqueueFlowRun(supabase, input.userId, input.flowId, input.leadId, keyed);
  return { ok: true, queued, firstRunAt: keyed[0]?.runAt.toISOString(), blockers: [] };
}
