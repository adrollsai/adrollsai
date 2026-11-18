import type { SupabaseClient } from '@supabase/supabase-js';
import { applyInternalAction } from './internal';
import { SCHEDULES } from './store';
import type { ScheduledStep } from './scheduling';

/**
 * One due step, turned into work.
 *
 * This lived inline in the cron route, which meant the only way to prove the queue worked was to
 * wait for a clock tick in production — and the only way to discover it was broken was for a
 * customer not to receive something. It is a function now so the probe (and any test) can run the
 * exact same code the cron runs.
 *
 * Two outcomes, and the difference is the whole safety story:
 *   - an internal step (handoff, tag, note) is APPLIED here: it touches the CRM, never a customer;
 *   - anything that would reach a customer is QUEUED as a complete approval row — real lead, real
 *     number, real text — and waits for a human. Nothing is sent from this file.
 */
export interface QueueOutcome {
  kind: 'queued_for_approval' | 'applied_internally';
  detail: string;
  /** Which scheduled row this came from, for reporting. */
  stepId: string;
}

export async function queueDueStep(
  supabase: SupabaseClient,
  input: { userId: string; step: ScheduledStep }
): Promise<QueueOutcome> {
  const { userId, step } = input;

  const { data: row } = await supabase
    .from(SCHEDULES)
    .select('payload, run_key, flow_id, lead_id')
    .eq('id', step.id)
    .maybeSingle();
  const payload: any = (row as any)?.payload ?? {};
  const runKey = String((row as any)?.run_key ?? step.runKey ?? 'once');

  if (step.kind === 'handoff') {
    const outcome = await applyInternalAction(supabase, {
      userId,
      leadId: step.leadId,
      flowId: step.flowId,
      internal: payload.internal ?? { kind: 'note', value: 'A human needs to take this conversation over.' },
    });
    if (!outcome.ok) throw new Error(outcome.detail);
    return { kind: 'applied_internally', detail: outcome.detail, stepId: step.id };
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, phone')
    .eq('id', step.leadId)
    .maybeSingle();
  const phone = String((lead as any)?.phone ?? '').replace(/[^\d+]/g, '');
  if (!phone) throw new Error(`no phone number on lead ${step.leadId}; cannot queue the step`);

  const text = String(payload.text ?? '').trim();
  const templateName = payload.templateName ? String(payload.templateName) : null;
  if (step.kind === 'message' && !text && !templateName) {
    throw new Error(`step ${step.stepIndex} has no message text or template in its payload`);
  }

  const { error: qErr } = await supabase.from('agent_pending_deliveries').insert({
    user_id: userId,
    lead_id: step.leadId,
    channel: step.kind === 'call' ? 'call' : 'whatsapp',
    to_phone: phone,
    body: step.kind === 'call' ? text || 'Flow follow-up call' : text,
    template_name: templateName,
    flow_id: step.flowId,
    flow_step_index: step.stepIndex,
    trigger: payload.trigger ?? null,
    run_key: runKey,
    status: 'pending_approval',
  });
  if (qErr) {
    // A queue write that fails must fail the step, not be swallowed: a step marked "done" whose
    // approval row never existed is a message that silently never happens.
    throw new Error(`could not queue step ${step.id}: ${qErr.message}`);
  }

  return {
    kind: 'queued_for_approval',
    detail: `queued ${step.kind} for ${(lead as any)?.name || phone} — waiting for approval`,
    stepId: step.id,
  };
}
