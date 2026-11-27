import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlowStore, ScheduledStep } from './scheduling';
import type { BranchGate } from './branching';

/**
 * The Supabase side of scheduling: the ledger, and the two facts that stop double sends.
 *
 * Everything here is deliberately small and boring. The interesting logic lives in scheduling.ts,
 * which is pure and proven by a gate; this file only reads and writes rows. It also degrades
 * quietly if the migration has not been applied yet — an empty ledger beats a broken dashboard.
 */

export const SCHEDULES = 'flow_schedules';
export const RUNS = 'flow_runs';
export const SETTINGS = 'flow_settings';

function mapStep(row: any): ScheduledStep {
  const payload = (row.payload ?? {}) as Record<string, any>;
  const gates = Array.isArray(payload.gates) ? (payload.gates as BranchGate[]) : undefined;
  return {
    id: String(row.id),
    flowId: String(row.flow_id),
    leadId: String(row.lead_id),
    stepIndex: Number(row.step_index),
    runAt: String(row.run_at),
    kind: row.kind,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    runKey: row.run_key ? String(row.run_key) : 'once',
    ...(gates?.length ? { gates } : {}),
  };
}

export function scheduledStore(supabase: SupabaseClient, userId: string): FlowStore {
  return {
    async dueSteps(now, limit) {
      const { data, error } = await supabase
        .from(SCHEDULES)
        // `payload` is read here because a step's branch gates live in it: without the payload a
        // gated step would look ungated and BOTH sides of a condition would run.
        .select('id, flow_id, lead_id, step_index, run_at, status, attempts, kind, run_key, payload')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .lte('run_at', now.toISOString())
        .order('run_at', { ascending: true })
        .limit(limit);
      if (error) return []; // migration not applied yet, or a transient read failure
      return (data ?? []).map(mapStep);
    },

    /**
     * The row a branch predicate is evaluated against.
     *
     * The whole row, deliberately: a condition may compare a plain column (`pipeline_stage`), a
     * JSON field (`custom_fields.budget`) or a number (`value`), and narrowing the select here would
     * silently make some of those compare against undefined.
     */
    async leadFor(leadId) {
      const { data, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
      if (error) return null;
      return (data as Record<string, any> | null) ?? null;
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

    async hasRun(flowId, leadId, stepIndex, runKey) {
      const { data, error } = await supabase
        .from(RUNS)
        .select('id')
        .eq('user_id', userId)
        .eq('flow_id', flowId)
        .eq('lead_id', leadId)
        .eq('step_index', stepIndex)
        .eq('run_key', runKey ?? 'once')
        .limit(1);
      if (error) return false;
      return (data ?? []).length > 0;
    },

    async recordRun(flowId, leadId, stepIndex, at, runKey) {
      // The unique index makes a duplicate insert fail rather than send twice; that failure is the
      // last line of defence, so it is swallowed deliberately.
      await supabase.from(RUNS).insert({
        user_id: userId,
        flow_id: flowId,
        lead_id: leadId,
        step_index: stepIndex,
        run_key: runKey ?? 'once',
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
      // `opted_out` is the column that says so; `pipeline_stage` carries the same intent for records
      // written before it existed. The select falls back to the older shape rather than treating a
      // schema difference as "everybody opted out" — that silently stopped every flow on every
      // account once, and the skip reason said the person had opted out, which was a lie.
      let data: any = null;
      let error: any = null;
      ({ data, error } = await supabase
        .from('leads')
        .select('id, opted_out, pipeline_stage')
        .eq('id', leadId)
        .maybeSingle());
      if (error) {
        ({ data, error } = await supabase
          .from('leads')
          .select('id, pipeline_stage')
          .eq('id', leadId)
          .maybeSingle());
      }
      if (error) return 'unreadable' as const; // cannot verify: do not message, but say why
      if (!data) return true; // no such lead: nothing to message
      const stage = String(data.pipeline_stage ?? '').toLowerCase();
      return data.opted_out === true || stage === 'opted_out' || stage === 'unsubscribed';
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

/** Read the owner's quiet hours, defaulting to 21:00–09:00. */
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

export type EnqueueKind = 'message' | 'call' | 'email' | 'dm_reply' | 'handoff';

/**
 * Write the waits down. Called when a flow fires, instead of holding the request open.
 * Returns how many rows were newly queued — a repeat call adds nothing, by design.
 */
export async function enqueueFlowRun(
  supabase: SupabaseClient,
  userId: string,
  flowId: string,
  leadId: string,
  steps: { stepIndex: number; kind: EnqueueKind; runAt: Date; payload?: Record<string, unknown>; runKey?: string }[],
  runKey = 'once'
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
    run_key: s.runKey ?? runKey,
    status: 'pending' as const,
  }));
  // upsert with ignoreDuplicates leans on flow_schedules_run_once_idx: enqueuing the same step of
  // the same run twice is a no-op rather than a second message.
  const { data, error } = await supabase
    .from(SCHEDULES)
    .upsert(rows, { onConflict: 'flow_id,lead_id,run_key,step_index', ignoreDuplicates: true })
    .select('id');
  // A silent zero is how a scheduler lies: it reads as "nothing to do" when the truth is "the write
  // failed". Surface it instead.
  if (error) throw new Error(`could not queue flow steps: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  return { queued: (data ?? []).length };
}
