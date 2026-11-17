import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlowStore, ScheduledStep } from './scheduling';

/**
 * The Supabase side of scheduling: the ledger, and the two facts that stop double sends.
 *
 * Everything here is deliberately small and boring. The interesting logic lives in scheduling.ts,
 * which is pure and proven by a gate; this file only reads and writes rows. It also degrades
 * quietly if the migration has not been applied yet â€” an empty ledger beats a broken dashboard.
 */

export const SCHEDULES = 'flow_schedules';
export const RUNS = 'flow_runs';
export const SETTINGS = 'flow_settings';

function mapStep(row: any): ScheduledStep {
  return {
    id: String(row.id),
    flowId: String(row.flow_id),
    leadId: String(row.lead_id),
    stepIndex: Number(row.step_index),
    runAt: String(row.run_at),
    kind: row.kind,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
  };
}

export function scheduledStore(supabase: SupabaseClient, userId: string): FlowStore {
  return {
    async dueSteps(now, limit) {
      const { data, error } = await supabase
        .from(SCHEDULES)
        .select('id, flow_id, lead_id, step_index, run_at, status, attempts, kind')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .lte('run_at', now.toISOString())
        .order('run_at', { ascending: true })
        .limit(limit);
      if (error) return []; // migration not applied yet, or a transient read failure
      return (data ?? []).map(mapStep);
    },

    async claim(stepId, now) {
      // Atomic: only a row that is still pending can be claimed, so two workers cannot both win.
      const { data, error } = await supabase
        .from(SCHEDULES)
        .update({ status: 'claimed', claimed_at: now.toISOString() })
        .eq('id', stepId)
        .eq('status', 'pending')
        .select('id');
      if (error) return false;
      return (data ?? []).length === 1;
    },

    async complete(stepId) {
      await supabase.from(SCHEDULES).update({ status: 'done' }).eq('id', stepId);
    },

    async skip(stepId, reason) {
      await supabase.from(SCHEDULES).update({ status: 'skipped', skip_reason: reason }).eq('id', stepId);
    },

    async hasRun(flowId, leadId, stepIndex) {
      const { data, error } = await supabase
        .from(RUNS)
        .select('id')
        .eq('user_id', userId)
        .eq('flow_id', flowId)
        .eq('lead_id', leadId)
        .eq('step_index', stepIndex)
        .limit(1);
      if (error) return false;
      return (data ?? []).length > 0;
    },

    async recordRun(flowId, leadId, stepIndex, at) {
      // The unique index makes a duplicate insert fail rather than send twice; that failure is the
      // last line of defence, so it is swallowed deliberately.
      await supabase.from(RUNS).insert({
        user_id: userId,
        flow_id: flowId,
        lead_id: leadId,
        step_index: stepIndex,
        kind: 'step',
        ran_at: at.toISOString(),
      });
    },

    async lastMessageAtForLead(leadId) {
      const { data, error } = await supabase
        .from(RUNS)
        .select('ran_at')
        .eq('user_id', userId)
        .eq('lead_id', leadId)
        .order('ran_at', { ascending: false })
        .limit(1);
      if (error || !data?.length) return null;
      return new Date(String(data[0].ran_at));
    },

    async isOptedOut(leadId) {
      const { data, error } = await supabase
        .from('leads')
        .select('id, opted_out, pipeline_stage')
        .eq('id', leadId)
        .maybeSingle();
      if (error || !data) return true; // unknown lead: do not message
      const stage = String((data as any).pipeline_stage ?? '').toLowerCase();
      return (data as any).opted_out === true || stage === 'opted_out' || stage === 'unsubscribed';
    },

    async isPaused(flowId) {
      const { data, error } = await supabase
        .from('automations')
        .select('is_active')
        .eq('user_id', userId)
        .eq('id', flowId)
        .maybeSingle();
      if (error) return true; // cannot verify: treat as paused
      return (data as any)?.is_active === false;
    },

    async isAllPaused() {
      const { data, error } = await supabase
        .from(SETTINGS)
        .select('all_paused')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return false;
      return (data as any)?.all_paused === true;
    },
  };
}

/** Read the owner's quiet hours, defaulting to 21:00â€“09:00. */
export async function quietHoursFor(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from(SETTINGS)
    .select('quiet_start, quiet_end')
    .eq('user_id', userId)
    .maybeSingle();
  const startHour = Number((data as any)?.quiet_start ?? 21);
  const endHour = Number((data as any)?.quiet_end ?? 9);
  return { startHour, endHour };
}

export type EnqueueKind = 'message' | 'call' | 'email' | 'dm_reply';

/**
 * Write the waits down. Called when a flow fires, instead of holding the request open.
 * Returns how many rows were newly queued â€” a repeat call adds nothing, by design.
 */
export async function enqueueFlowRun(
  supabase: SupabaseClient,
  userId: string,
  flowId: string,
  leadId: string,
  steps: { stepIndex: number; kind: EnqueueKind; runAt: Date; payload?: Record<string, unknown> }[]
): Promise<{ queued: number }> {
  if (!steps.length) return { queued: 0 };
  const rows = steps.map((s) => ({
    user_id: userId,
    flow_id: flowId,
    lead_id: leadId,
    step_index: s.stepIndex,
    kind: s.kind,
    payload: s.payload ?? {},
    run_at: s.runAt.toISOString(),
    status: 'pending' as const,
  }));
  // upsert with ignoreDuplicates leans on flow_schedules_once_idx: enqueuing the same step twice
  // is a no-op rather than a second message.
  const { data, error } = await supabase
    .from(SCHEDULES)
    .upsert(rows, { onConflict: 'flow_id,lead_id,step_index', ignoreDuplicates: true })
    .select('id');
  // A silent zero is how a scheduler lies: it reads as "nothing to do" when the truth is "the write
  // failed". Surface it instead.
  if (error) throw new Error(`could not queue flow steps: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  return { queued: (data ?? []).length };
}
