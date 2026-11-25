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

/**
 * Did the agent already produce something for this tenant today?
 *
 * `fallbackDecision({ agentProducedToday })` was written with this answer in mind, but
 * the call sites passed a hardcoded `false` and resolved it "below, from the assets
 * check" — where the check that remained counted EVERY image the tenant owned. The
 * result was a guard that could not tell the difference between three things:
 *
 *   the agent doing its job        -> the fallback must stay quiet
 *   the owner making one poster    -> the fallback is still owed today's creative
 *   yesterday's automation         -> already counted by its own dated key
 *
 * So "produced today" is defined relative to the day's routine run: an artefact that
 * appeared AFTER that run started is the agent's work; anything older (or anything on a
 * day with no routine run at all) is not, and the fallback fills the gap.
 *
 * This is what stops one manual generation from silently cancelling the owner's daily
 * creative — and, equally, stops an active routine from being duplicated by the
 * fallback pipeline on the same day.
 */
export async function agentProducedToday(
  supabaseAdmin: any,
  userId: string,
  periodKey: string
): Promise<boolean> {
  try {
    const { data: runs, error } = await supabaseAdmin
      .from('routine_runs')
      .select('created_at')
      .eq('user_id', userId)
      .eq('period_key', periodKey)
      .order('created_at', { ascending: true })
      .limit(1);

    if (error || !Array.isArray(runs) || runs.length === 0) return false;
    const startedAt = runs[0]?.created_at;
    if (!startedAt) return false;

    const { data: assets, error: assetErr } = await supabaseAdmin
      .from('assets')
      .select('id')
      .eq('user_id', userId)
      .in('type', ['image', 'video'])
      .gte('created_at', startedAt)
      .limit(1);

    if (assetErr) return false;
    return Array.isArray(assets) && assets.length > 0;
  } catch {
    return false;
  }
}
