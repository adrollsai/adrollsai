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
import { queryKieTask } from '@/utils/external-apis';
import { extensionFor, kindFromUrl, mirrorToR2 } from '@/lib/media/mirror';

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
 * Stop a video task lying about being in progress — but ASK THE PROVIDER FIRST.
 *
 * At 45 minutes the callback is not late, it is not coming, and the 20-minute watchdog has already
 * had two sweeps. Leaving `Processing` means the tenant stares at a spinner forever and support has
 * no error to read.
 *
 * WHAT THIS REPAIR GOT WRONG, measured on production 2026-11-26. It declared the render "abandoned"
 * without asking the provider anything. Fourteen of sixteen tasks were failed this way — and a direct
 * `recordInfo` query returned `state: success` with a result URL for every one of them. The renders
 * existed; only our callback had been lost. Because the failure was final, the sync sweep (which only
 * looked at `Processing`) could never see them again, `retry_count` stayed 0, and eight tenants got no
 * daily creative at all while a finished video sat at Kie.ai. The owner's reading — "you never sent it"
 * — was correct.
 *
 * So the provider is asked before the task is failed. If it has the render, the task goes back to
 * `Processing` carrying the note, which is exactly the state the 20-minute watchdog sweeps and
 * finalises (persist to R2, stitch, deliver to the owner with Approve/Edit). Only a provider that
 * reports `fail`, or one that cannot be asked at all, produces a `Failed` row.
 */
const failAbandonedVideoTask: Repair = {
  class: 'video-task-stuck-processing',
  blastRadius: 'safe',
  describe: 'Ask the provider whether it has the render; re-queue it if it does, else fail it with the reason.',
  table: 'video_tasks',
  columns: ['status', 'last_error', 'updated_at'],
  async apply(incident: Incident, ctx: DetectorContext): Promise<RepairOutcome> {
    if (!incident.subject_id) return { ok: false, detail: 'Incident has no task id.' };

    const nowIso = ctx.now.toISOString();

    // ── 1. What does the provider actually say? ──────────────────────────────
    let providerState: string | null = null;
    let providerError: string | null = null;
    let providerHasRender = false;
    try {
      const { data: taskRow } = await ctx.supabase
        .from('video_tasks')
        .select('id, last_task_id, status, retry_count')
        .eq('id', incident.subject_id)
        .maybeSingle();

      const providerTaskId = (taskRow as any)?.last_task_id;
      // Already settled by someone else: nothing to decide.
      if ((taskRow as any)?.status !== 'Processing') {
        return { ok: true, detail: 'Nothing to do: the task is no longer Processing.', touched: [] };
      }

      if (providerTaskId) {
        const { queryKieTask } = await import('@/utils/external-apis');
        const answer = await queryKieTask(String(providerTaskId));
        providerState = String(answer?.state || 'unknown');
        providerError = answer?.error ? String(answer.error) : null;
        providerHasRender = providerState === 'success' && Boolean(answer?.resultUrl);

        if (providerHasRender) {
          /**
           * The render exists. Put the task back in the state the sync sweep watches, so the ordinary
           * finalisation path (R2 persist → stitch → WhatsApp with Approve/Edit) does the rest. This
           * repair stays fast on purpose: the ops watchdog has a duration budget, and a 40 MB download
           * plus an FFmpeg stitch does not belong in it.
           */
          const { data: requeued, error } = await ctx.supabase
            .from('video_tasks')
            .update({
              status: 'Processing',
              retry_count: 0,
              last_error:
                `ops-watchdog: our callback was lost but the provider finished the render ` +
                `(state=${providerState}). Re-queued for finalisation and delivery instead of failing it.`,
              updated_at: nowIso,
            })
            .eq('id', incident.subject_id)
            .eq('status', 'Processing')
            .select('id');

          if (error) return { ok: false, detail: `Could not re-queue task: ${String(error.message || error)}` };
          const affected = Array.isArray(requeued) ? requeued.length : 0;
          if (affected === 0) return { ok: true, detail: 'Nothing to do: the task finished on its own.', touched: [] };
          return {
            ok: true,
            detail:
              `Provider had the render (state=${providerState}); task ${incident.subject_id} re-queued for ` +
              'finalisation and owner delivery rather than failed.',
            touched: this.columns,
          };
        }
      }
    } catch (probeErr: any) {
      // A provider we cannot reach is not proof of abandonment, but it is also not proof of a render.
      // Fall through to failing the task, and say which happened.
      providerError = providerError || probeErr?.message || String(probeErr);
    }

    // ── 2. The provider genuinely has nothing: say so, with its own words ────
    const reasonBits = [
      'ops-watchdog: the render could not be confirmed.',
      providerState ? `Provider state=${providerState}.` : '',
      providerError ? `Provider said: ${providerError}.` : '',
      'Marked failed so it is not left waiting. Please generate again.',
    ].filter(Boolean);

    const { data, error } = await ctx.supabase
      .from('video_tasks')
      .update({
        status: 'Failed',
        last_error: reasonBits.join(' '),
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

/**
 * Finish an asset whose render actually SUCCEEDED at the provider.
 *
 * WHY THIS IS SAFE, AND WHY IT HAD TO EXIST
 * A live client paid 6 credits for an image that Kie finished in 72 seconds. The provider
 * said `state: success` and returned a URL; our row sat in `Rendering` for ten hours and he
 * never saw the result. `generate_ai_image` hands back a task id when the render outlives its
 * own polling window, and collecting it afterwards depended entirely on the agent remembering
 * to call `check_media_task` later in the same turn. If the turn ended — or stopped at an
 * approval card — nothing ever collected it.
 *
 * The watchdog can now do the collecting, on the one condition that makes it provable: the
 * PROVIDER says the work is done. Then writing the URL is not a guess about what the tenant
 * wanted, it is delivering what they already paid for.
 *
 * Deliberately narrow:
 *   - the provider is asked first, and only `success` produces a write;
 *   - a provider failure marks the asset Failed, so the library stops showing a spinner;
 *   - a render still in progress is left alone and reported, not guessed at;
 *   - the status re-asserts `Rendering` in the UPDATE, so if the tool collected it in the
 *     meantime this matches zero rows instead of overwriting a fresher URL.
 */
const collectFinishedAsset: Repair = {
  class: 'asset-stuck-rendering',
  blastRadius: 'safe',
  describe: 'Ask the provider whether a stuck render finished; if it did, store the media permanently and mark the asset ready.',
  table: 'assets',
  columns: ['url', 'status'],
  async apply(incident: Incident, ctx: DetectorContext): Promise<RepairOutcome> {
    if (!incident.subject_id) return { ok: false, detail: 'Incident has no asset id.' };

    const { data: assetRows, error: readError } = await ctx.supabase
      .from('assets')
      .select('id, user_id, type, status, kie_task_id, url')
      .eq('id', incident.subject_id)
      .limit(1);
    if (readError) return { ok: false, detail: `Could not read the asset: ${String(readError.message || readError)}` };

    const asset = (assetRows ?? [])[0] as Record<string, any> | undefined;
    if (!asset) return { ok: false, detail: 'Asset no longer exists.' };

    const taskId = String(asset.kie_task_id || '').trim();
    if (!taskId) {
      return {
        ok: false,
        detail: 'This asset has no provider task id, so there is nothing to collect — a human has to look at it.',
      };
    }

    let status: any;
    try {
      status = await queryKieTask(taskId);
    } catch (err: any) {
      return { ok: false, detail: `Could not ask the provider about ${taskId}: ${err?.message || err}` };
    }

    if (status.state === 'fail') {
      const { data: failed } = await ctx.supabase
        .from('assets')
        .update({ status: 'Failed' })
        .eq('id', asset.id)
        .eq('status', 'Rendering')
        .select('id');
      const touched = Array.isArray(failed) && failed.length > 0;
      return {
        ok: true,
        detail: touched
          ? `Provider reports the render failed; asset marked Failed so the library stops showing it as unfinished.`
          : 'Provider reports a failure, but the asset had already moved on — left alone.',
        touched: touched ? this.columns : [],
      };
    }

    if (status.state !== 'success' || !status.resultUrl) {
      return {
        ok: false,
        detail: `Provider still working (state: ${status.state}); nothing collected yet.`,
      };
    }

    const kind = kindFromUrl(status.resultUrl);
    const permanentUrl = await mirrorToR2(
      status.resultUrl,
      `media_${taskId}.${extensionFor(kind)}`,
      String(asset.user_id)
    );

    const { data: updated } = await ctx.supabase
      .from('assets')
      .update({ url: permanentUrl, status: 'ready' })
      .eq('id', asset.id)
      // Only if it is still stuck: never overwrite a fresher collection.
      .eq('status', 'Rendering')
      .select('id');

    const touched = Array.isArray(updated) && updated.length > 0;
    if (!touched) {
      return { ok: true, detail: 'Provider had finished, but the asset was already collected — left alone.', touched: [] };
    }
    return {
      ok: true,
      detail: `Collected the finished ${kind} the provider produced and marked the asset ready.`,
      touched: this.columns,
    };
  },
};

/** The complete allowlist. This object is the whole of what the watchdog may change. */
export const REPAIRS: Readonly<Record<string, Repair>> = Object.freeze({
  [requeueAbandonedRun.class]: requeueAbandonedRun,
  [nudgeStarvedQueue.class]: nudgeStarvedQueue,
  [failAbandonedVideoTask.class]: failAbandonedVideoTask,
  [collectFinishedAsset.class]: collectFinishedAsset,
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
