/**
 * The only code in this system that writes to production, and the rules that keep it small.
 *
 * THE DESIGN CONSTRAINT
 * The owner's decision was: safe repairs run by themselves, everything else waits for a
 * human. "Safe" has to mean something checkable, or the first clever detector quietly
 * becomes a system that rewrites customer records at 3am. So safety is not a comment here —
 * it is three independent gates, all of which must pass before a single row changes:
 *
 *   1. THE CLASS ALLOWLIST. A repair must be registered in `REPAIRS` under the exact detector
 *      class. There is no wildcard, no prefix match, no "default repair". An unregistered
 *      class is never fixed, by design.
 *
 *   2. THE TABLE AND RADIUS AGREEMENT. The repair declares the one table it may touch and the
 *      blast radius it claims. The healer compares both against the incident and refuses on
 *      any disagreement. A repair cannot be widened without editing this file, and editing
 *      this file is a reviewable act.
 *
 *   3. THE FORBIDDEN TABLES. Money, identity, tenant-owned content and outbound messaging are
 *      listed below and can never appear in a repair, whatever the incident says. This is a
 *      deny-list precisely because an allow-list of columns would grow, while this list only
 *      ever needs to be added to when someone finds a new way to hurt a customer.
 *
 * WHY EVERY REPAIR IS A STATE-MACHINE NUDGE
 * Look at what each one actually writes: an expired lease, an already-past timestamp, a
 * leaked lock, a status that says "Processing" when nothing is processing. Not one of them
 * changes money, content, or intent — they only remove an obstacle that has already expired,
 * so the app's existing machinery can do its job. That is the entire definition of a safe
 * repair, and anything that does not fit it belongs in `needs_approval`.
 */

import type { DetectorContext, Incident, Repair, RepairOutcome } from './types';

/**
 * Tables no repair may ever touch, whatever the incident says.
 *
 * Everything that records money that has actually moved is here, and stays here. `wallets`
 * is listed because a repair must never adjust a balance directly — the only correct ways to
 * change one are a payment or a run's own charge/refund path.
 *
 * `credit_holds` is deliberately NOT in this list, and that is the one exception worth
 * understanding. A hold is a *reservation*, not a movement: releasing an expired hold whose
 * `spent` is 0 cannot change what the tenant paid, because no ledger row exists for it. The
 * repair below re-asserts `spent = 0` inside the UPDATE, so a hold that gained spend between
 * detection and repair matches zero rows and is left for a human. The class that *does* carry
 * spend (`credit-hold-expired-with-spend`) is a separate registration that nothing can repair
 * — it can only be reported, which is why the split exists rather than a condition inside one
 * repair. A conditional repair is one refactor away from being unconditional.
 */
export const FORBIDDEN_TABLES: readonly string[] = [
  // money that has moved, or could
  'credit_transactions',
  'wallet_transactions',
  'transactions',
  'wallets',
  'subscriptions',
  'payments',
  // who a tenant is
  'profiles',
  'organizations',
  'organization_members',
  'auth.users',
  // a customer
  'leads',
  'whatsapp_messages',
  'whatsapp_chats',
  'call_logs',
  // spending money outward
  'campaigns',
  'ads',
  'meta_ads',
];

/**
 * How many times the watchdog will try to fix the same condition before it gives up.
 *
 * Three. A safely-repairable condition that keeps coming back is not a stuck state any more,
 * it is a bug producing stuck states, and repairing it a fourth time only hides that. On the
 * third failure the incident is left open with the attempts visible for a person to read.
 */
export const MAX_REPAIR_ATTEMPTS = 3;

/**
 * Quiet period before trying again after a successful repair.
 *
 * Without it, a repair that works and a repair that is needed again 30 seconds later are
 * indistinguishable, and an incident that flaps would be "fixed" on every sweep. Ten minutes
 * is below the sweep interval, so a genuinely new occurrence is still handled promptly.
 */
export const REPAIR_COOLDOWN_MINUTES = 10;

/**
 * Re-queue a run whose worker is provably gone.
 *
 * The lease is the proof. `lib/agent/harness/runner.ts` makes a slice resumable from its
 * checkpoint, and `claimRun` will not hand out a run whose lease is still valid — so clearing
 * an expired lease cannot cause two workers to run the same slice.
 */
const requeueAbandonedRun: Repair = {
  class: 'harness-run-lease-expired',
  blastRadius: 'safe',
  describe: 'Clear the expired worker lease and put the run back in the queue, so it resumes from its checkpoint.',
  table: 'harness_runs',
  columns: ['status', 'lease_owner', 'lease_expires_at', 'next_attempt_at', 'updated_at'],
  async apply(incident: Incident, ctx: DetectorContext): Promise<RepairOutcome> {
    if (!incident.subject_id) return { ok: false, detail: 'Incident has no run id to requeue.' };

    const nowIso = ctx.now.toISOString();
    const { data, error } = await ctx.supabase
      .from('harness_runs')
      .update({
        status: 'queued',
        lease_owner: null,
        lease_expires_at: null,
        next_attempt_at: nowIso,
        updated_at: nowIso,
      })
      // The guard that makes this safe even if the detector raced a live worker: only a run
      // that is STILL running is touched, and only if its lease is still in the past.
      .eq('id', incident.subject_id)
      .eq('status', 'running')
      .lt('lease_expires_at', nowIso)
      .select('id');

    if (error) return { ok: false, detail: `Could not requeue run: ${String(error.message || error)}` };

    const affected = Array.isArray(data) ? data.length : 0;
    if (affected === 0) {
      // Somebody else got there first — a worker resumed it, or a human requeued it. Not a
      // failure: the condition is gone, which is the whole point.
      return { ok: true, detail: 'Nothing to do: the run had already been requeued or resumed.', touched: [] };
    }
    return { ok: true, detail: `Requeued run ${incident.subject_id} from its checkpoint.`, touched: this.columns };
  },
};

/**
 * Make starved queued runs eligible now.
 *
 * `next_attempt_at` in the past is already eligible from the claim query's point of view in
 * most cases; this repair exists for the rows where a backoff timestamp got written far into
 * the future by a retry storm. It moves a timestamp to now and touches nothing else.
 */
const nudgeStarvedQueue: Repair = {
  class: 'harness-run-queued-starved',
  blastRadius: 'safe',
  describe: 'Move the queued runs\' next-attempt time to now so the worker can claim them.',
  table: 'harness_runs',
  columns: ['next_attempt_at', 'updated_at'],
  async apply(incident: Incident, ctx: DetectorContext): Promise<RepairOutcome> {
    const ids = Array.isArray(incident.detail?.runIds) ? (incident.detail?.runIds as string[]) : [];
    if (!ids.length) return { ok: false, detail: 'Incident listed no run ids to nudge.' };

    const nowIso = ctx.now.toISOString();
    const { data, error } = await ctx.supabase
      .from('harness_runs')
      .update({ next_attempt_at: nowIso, updated_at: nowIso })
      .in('id', ids)
      .eq('status', 'queued')
      .select('id');

    if (error) return { ok: false, detail: `Could not nudge queued runs: ${String(error.message || error)}` };

    const affected = Array.isArray(data) ? data.length : 0;
    return {
      ok: true,
      detail: `Made ${affected} of ${ids.length} queued run(s) eligible immediately.`,
      touched: this.columns,
    };
  },
};

/**
 * Stop a video task lying about being in progress.
 *
 * At 45 minutes the provider callback is not late, it is not coming, and the 20-minute
 * watchdog has already had two sweeps. Leaving `Processing` means the tenant stares at a
 * spinner forever and support has no error to read. Failing it with the reason is the honest
 * state, and the tenant can simply generate again.
 */
const failAbandonedVideoTask: Repair = {
  class: 'video-task-stuck-processing',
  blastRadius: 'safe',
  describe: 'Mark the abandoned render task failed with the reason, so the tenant is told instead of waiting.',
  table: 'video_tasks',
  columns: ['status', 'last_error', 'updated_at'],
  async apply(incident: Incident, ctx: DetectorContext): Promise<RepairOutcome> {
    if (!incident.subject_id) return { ok: false, detail: 'Incident has no task id.' };

    const nowIso = ctx.now.toISOString();
    const { data, error } = await ctx.supabase
      .from('video_tasks')
      .update({
        status: 'Failed',
        last_error:
          'ops-watchdog: the video provider never called back and the render was abandoned. ' +
          'Marked failed so it is not left waiting. Please generate again.',
        updated_at: nowIso,
      })
      .eq('id', incident.subject_id)
      // Only while it is still stuck: if the provider finally answered, leave the success alone.
      .eq('status', 'Processing')
      .select('id');

    if (error) return { ok: false, detail: `Could not fail task: ${String(error.message || error)}` };

    const affected = Array.isArray(data) ? data.length : 0;
    if (affected === 0) {
      return { ok: true, detail: 'Nothing to do: the task finished on its own.', touched: [] };
    }
    return { ok: true, detail: `Marked task ${incident.subject_id} failed with the reason recorded.`, touched: this.columns };
  },
};

/**
 * Clear a site build's leaked worker lock.
 *
 * `locked_until` in the past is already expired in wall-clock terms; clearing it means the
 * next worker pass does not have to reason about a stale timestamp at all. The job's status
 * and attempt count are untouched, so nothing is skipped or charged twice.
 */
const clearLeakedSiteBuildLock: Repair = {
  class: 'site-build-lock-leaked',
  blastRadius: 'safe',
  describe: 'Clear the expired worker lock so the next build pass can claim the job.',
  table: 'site_build_jobs',
  columns: ['locked_until', 'updated_at'],
  async apply(incident: Incident, ctx: DetectorContext): Promise<RepairOutcome> {
    if (!incident.subject_id) return { ok: false, detail: 'Incident has no job id.' };

    const nowIso = ctx.now.toISOString();
    const { data, error } = await ctx.supabase
      .from('site_build_jobs')
      .update({ locked_until: null, updated_at: nowIso })
      .eq('id', incident.subject_id)
      .eq('status', 'pending')
      .lt('locked_until', nowIso)
      .select('id');

    if (error) return { ok: false, detail: `Could not clear lock: ${String(error.message || error)}` };

    const affected = Array.isArray(data) ? data.length : 0;
    if (affected === 0) return { ok: true, detail: 'Nothing to do: the lock was already cleared.', touched: [] };
    return { ok: true, detail: `Cleared the leaked lock on job ${incident.subject_id}.`, touched: this.columns };
  },
};

/**
 * Release a credit reservation that bought nothing.
 *
 * The narrowest possible money repair, and the reason it is allowed at all: `spent = 0` means
 * no ledger row exists for this hold, so releasing it cannot reduce what the tenant paid and
 * cannot create a charge. It only stops credits being subtracted for work that never
 * happened. The `spent = 0` condition is re-asserted in the UPDATE itself — if a worker
 * settled part of the hold between detection and repair, this matches zero rows and gives up.
 */
const releaseLeakedCreditHold: Repair = {
  class: 'credit-hold-leaked',
  blastRadius: 'safe',
  describe: 'Release an expired reservation that spent nothing, returning the reserved credits to the tenant.',
  table: 'credit_holds',
  columns: ['state', 'settled_at'],
  async apply(incident: Incident, ctx: DetectorContext): Promise<RepairOutcome> {
    if (!incident.subject_id) return { ok: false, detail: 'Incident has no hold id.' };

    const { data, error } = await ctx.supabase
      .from('credit_holds')
      .update({ state: 'released', settled_at: ctx.now.toISOString() })
      .eq('id', incident.subject_id)
      .eq('state', 'open')
      // Belt and braces: never release a hold that has spend against it.
      .eq('spent', 0)
      .select('id');

    if (error) return { ok: false, detail: `Could not release hold: ${String(error.message || error)}` };

    const affected = Array.isArray(data) ? data.length : 0;
    if (affected === 0) {
      return {
        ok: true,
        detail: 'Nothing to do: the hold was already settled, released, or now carries spend — left for a human.',
        touched: [],
      };
    }
    return { ok: true, detail: `Released hold ${incident.subject_id}; no ledger entry existed, so no money moved.`, touched: this.columns };
  },
};

/** The complete allowlist. This object is the whole of what the watchdog may change. */
export const REPAIRS: Readonly<Record<string, Repair>> = Object.freeze({
  [requeueAbandonedRun.class]: requeueAbandonedRun,
  [nudgeStarvedQueue.class]: nudgeStarvedQueue,
  [failAbandonedVideoTask.class]: failAbandonedVideoTask,
  [clearLeakedSiteBuildLock.class]: clearLeakedSiteBuildLock,
  [releaseLeakedCreditHold.class]: releaseLeakedCreditHold,
});

/** The repair for a class, or null when nothing is registered — which is the common case. */
export function repairFor(incidentClass: string): Repair | null {
  return REPAIRS[incidentClass] ?? null;
}

/** Why a repair may not run. `null` means it may. */
export type RefusalReason =
  | 'not-registered'
  | 'radius-mismatch'
  | 'table-mismatch'
  | 'forbidden-table'
  | 'attempts-exhausted'
  | 'cooling-down';

/**
 * Decide whether this repair may run, and say why not when it may not.
 *
 * Returns a reason rather than a boolean so the sweep's response can explain every suppressed
 * action. "The watchdog did nothing" and "the watchdog wanted to act and refused" are very
 * different facts during an incident review, and only one of them is reassuring.
 */
export function refusalReason(
  repair: Repair | null,
  incident: Incident,
  now: Date,
): RefusalReason | null {
  if (!repair) return 'not-registered';

  // Gate 2: the repair's claims must agree with the incident's.
  if (repair.blastRadius !== 'safe' || incident.blast_radius !== 'safe') return 'radius-mismatch';
  if (repair.table !== incident.subject_table) return 'table-mismatch';

  // Gate 3: hard deny-list, checked last so the reason reported is the most specific one.
  const table = String(incident.subject_table ?? '').toLowerCase();
  if (FORBIDDEN_TABLES.some((forbidden) => table === forbidden)) return 'forbidden-table';

  // Loop protection.
  if ((incident.repair_attempts ?? 0) >= MAX_REPAIR_ATTEMPTS) return 'attempts-exhausted';
  if (incident.last_repaired_at) {
    const since = now.getTime() - Date.parse(incident.last_repaired_at);
    if (Number.isFinite(since) && since < REPAIR_COOLDOWN_MINUTES * 60_000) return 'cooling-down';
  }

  return null;
}
