/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped (stale generated types). */
/**
 * What happens when the agent produces nothing.
 *
 * The daily routine is now composed by the agent from its own tools. That is more
 * capable than the fixed pipeline it replaces and it has, unavoidably, more ways
 * to fail: a model outage, a vendor rejecting a prompt, a run that runs out of
 * credits half way.
 *
 * On a bad day the business should still get *something*. So the original
 * `auto-generate` / `auto-generate-video` crons stay in place as the fallback, and
 * this module decides when they are allowed to act:
 *
 *   agent produced something today  -> stay quiet (no double production)
 *   agent produced nothing          -> fill the gap
 *   AUTOMATION_PIPELINE_FALLBACK=0  -> never act (the flag, for the day we trust
 *                                      the agent completely)
 *
 * The "produced something today" test is not a new table: it is whether an asset
 * was created for the tenant today, which is exactly what the crons already check.
 * Keeping the decision in one pure function makes it reviewable.
 */

export interface FallbackDecisionInput {
  /** Global switch: false disables the legacy pipeline entirely. */
  enabled: boolean;
  /** An agent-composed artefact already exists for this tenant today. */
  agentProducedToday: boolean;
  /** A routine run is queued/running for today (it may still produce). */
  agentRunInFlight: boolean;
  /** The tenant switched the feature off themselves. */
  tenantDisabled?: boolean;
  /** A manual force from the operator overrides everything but the tenant switch. */
  forced?: boolean;
}

export interface FallbackDecision {
  run: boolean;
  reason:
    | 'fallback_disabled'
    | 'tenant_disabled'
    | 'already_produced_today'
    | 'agent_run_in_flight'
    | 'forced'
    | 'agent_produced_nothing';
}

/** Pure: the whole policy in one place, so it can be tested without a database. */
export function fallbackDecision(input: FallbackDecisionInput): FallbackDecision {
  if (input.tenantDisabled) return { run: false, reason: 'tenant_disabled' };
  if (input.forced) return { run: true, reason: 'forced' };
  if (!input.enabled) return { run: false, reason: 'fallback_disabled' };
  if (input.agentProducedToday) return { run: false, reason: 'already_produced_today' };
  // A run that is still working may yet produce today's artefact; firing the
  // pipeline now would duplicate it. The cron runs again later either way.
  if (input.agentRunInFlight) return { run: false, reason: 'agent_run_in_flight' };
  return { run: true, reason: 'agent_produced_nothing' };
}

/**
 * Read the env switch. Default ON: the fallback exists precisely for the day
 * nobody is watching, so it must not need someone to remember to enable it.
 */
export function legacyPipelineEnabled(): boolean {
  const raw = String(process.env.AUTOMATION_PIPELINE_FALLBACK ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return true;
}

/**
 * Is a routine run in flight for this tenant today?
 *
 * Returns false when the routines tables do not exist yet (pre-migration), which
 * leaves the fallback in charge — the safe answer for an un-migrated database.
 */
export async function agentRunInFlight(
  supabaseAdmin: any,
  userId: string,
  periodKey: string
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('routine_runs')
      .select('status')
      .eq('user_id', userId)
      .eq('period_key', periodKey)
      .in('status', ['queued', 'running'])
      .limit(1);

    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
