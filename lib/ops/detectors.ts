/**
 * What the watchdog watches.
 *
 * Every detector here is read-only and returns descriptions. None of them writes anything,
 * which is deliberate: this is the file you read to know whether the system is looking at
 * the right things, and you should be able to read it without auditing side effects.
 *
 * ── how a detector earns its place ────────────────────────────────────────────
 * A condition belongs here when all three are true:
 *   1. it is invisible to the owner until a customer complains,
 *   2. it persists (so a 30-minute sweep will still see it),
 *   3. the app's own machinery has already had a chance to fix it and did not.
 *
 * Thresholds were chosen against live data, not guessed. Two examples of what that changed:
 *
 *   • `leads.processing_lock_until` looked like a lock-leak detector, but the code that
 *     reads it compares against `now` (`lib/automation/call-queue.ts`), so an expired lock
 *     is already ignored. Reporting it would have been a permanent false positive. Dropped.
 *   • `video_tasks` is empty in production while `assets.status` carries the real render
 *     state, so the render detectors cover both and the `assets` one only reports, because
 *     rewriting a tenant's asset row is not a safe repair.
 *
 * ── aggregation, not enumeration ──────────────────────────────────────────────
 * One broken caller produced 36 dead runs with identical errors (measured). Reporting that
 * as 36 incidents would bury the board and burn 36 round trips a sweep. Detectors that can
 * fire repeatedly therefore group by *cause* and report one condition with a count and the
 * offending ids in `detail` — the owner reads "one bug, 36 victims", which is also the truth.
 */

import type { Detection, Detector, DetectorContext } from './types';

// ── thresholds ───────────────────────────────────────────────────────────────
// Named and exported so the verify gate can assert what the system claims to watch, and so
// a reviewer can argue with a number without reading the query around it.

/** A `running` run with no lease for this long is presumed dead. */
export const STUCK_RUN_MINUTES = 5;
/** A `queued` run that nobody has claimed for this long means the drainer is not draining. */
export const QUEUED_STARVED_MINUTES = 15;
/** No movement in `harness_runs` at all for this long, with work waiting, means the cron is dead. */
export const RUNNER_SILENT_MINUTES = 15;
/** How far back the dead-letter detector looks. A day is the span an owner reports on. */
export const DEAD_LETTER_LOOKBACK_HOURS = 24;
/** One error seen this many times in the window is systemic, not bad luck. */
export const SYSTEMIC_FAILURE_THRESHOLD = 3;
/** A video task that provider callbacks abandoned. The video watchdog sweeps at 20 min. */
export const VIDEO_TASK_STUCK_MINUTES = 45;
/** An asset stuck mid-render. Reported only: it is tenant content. */
export const ASSET_RENDERING_STUCK_MINUTES = 60;
/** A site build whose worker lock leaked. */
export const SITE_BUILD_LOCKED_MINUTES = 15;
/** A credit reservation past its expiry with nothing spent is a leak. */
export const CREDIT_HOLD_STALE_MINUTES = 30;
/** Usage that was never priced. Two hours is inside the billing window either way. */
export const UNPRICED_USAGE_AFTER_MINUTES = 120;
/** Pending agent events this far past their scheduled time are a backlog. */
export const AGENT_EVENT_BACKLOG_MINUTES = 30;
/** Slack for a reachability probe before the app counts as slow. */
export const APP_PROBE_TIMEOUT_MS = 10_000;

/** Rows a single detector will consider. Above this the diagnosis is "the table is on fire". */
const SCAN_LIMIT = 500;

const minutesAgo = (now: Date, minutes: number): string =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

const hoursAgo = (now: Date, hours: number): string =>
  new Date(now.getTime() - hours * 3_600_000).toISOString();

/** "12m ago" / "3h ago" — the owner thinks in durations, not ISO strings. */
function ago(from: string | null | undefined, now: Date): string {
  if (!from) return 'never';
  const then = Date.parse(from);
  if (!Number.isFinite(then)) return 'unknown';
  const minutes = Math.round((now.getTime() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Collapse an error into the head that identifies the bug, not the instance.
 *
 * Exported for `scripts/verify-ops-watchdog.mjs`, which asserts that two instances of the same
 * failure collapse to one head while two genuinely different failures do not — that property is
 * what makes the dead-letter detector report "one bug, 36 victims" instead of 36 incidents.
 */
export function errorHead(error: string | null | undefined): string {
  const text = String(error ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '(no error recorded)';
  // Strip the volatile parts first, or every instance gets its own "root cause".
  return text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<ts>')
    .replace(/\b\d{6,}\b/g, '<n>')
    .slice(0, 140);
}

// ── 1. agent runs: the durable runner ────────────────────────────────────────

/**
 * A run claimed by a worker that then stopped existing.
 *
 * This is the safest repair the system performs. The lease is *proof* that nobody is
 * working on the run any more, the run is checkpoint-resumable by design
 * (`lib/agent/harness/runner.ts`), and the alternative is a tenant watching a turn that
 * will never finish. Re-queuing only when attempts remain is what keeps it from looping
 * forever: an exhausted run is a different, human problem.
 */
export const leaseExpiredDetector: Detector = {
  id: 'harness-run-lease-expired',
  watches:
    'Agent runs marked running whose worker lease has expired — a turn the tenant is watching that nobody is working on.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const cutoff = minutesAgo(ctx.now, STUCK_RUN_MINUTES);
    const { data, error } = await ctx.supabase
      .from('harness_runs')
      .select('id, user_id, attempts, max_attempts, continuations, lease_owner, lease_expires_at, last_heartbeat_at, updated_at')
      .eq('status', 'running')
      .limit(SCAN_LIMIT);
    if (error) throw new Error(`harness_runs (running): ${String(error.message || error)}`);

    const detections: Detection[] = [];
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const expiry = (row.lease_expires_at ?? row.last_heartbeat_at ?? row.updated_at) as string | null;
      if (!expiry || Date.parse(expiry) >= Date.parse(cutoff)) continue;

      const attempts = Number(row.attempts ?? 0);
      const maxAttempts = Number(row.max_attempts ?? 5);
      if (attempts >= maxAttempts) {
        // Exhausted: re-queuing would spin. This is the human's call, not ours.
        detections.push({
          class: 'harness-run-attempts-exhausted',
          severity: 'critical',
          title: 'An agent run used up every retry and is still marked running',
          evidence:
            `Run ${row.id} has expired its worker lease ${ago(expiry, ctx.now)} after ${attempts} of ` +
            `${maxAttempts} attempts, so it will be retried no further and the tenant sees a turn that never ends.`,
          suggestedFix:
            'Mark it dead so the tenant is told, then fix the underlying error before the next attempt.',
          blastRadius: 'needs_approval',
          subjectTable: 'harness_runs',
          subjectId: String(row.id),
          userId: (row.user_id as string | null) ?? null,
          detail: { attempts, maxAttempts, continuations: row.continuations ?? null },
        });
        continue;
      }

      detections.push({
        class: 'harness-run-lease-expired',
        severity: 'warning',
        title: 'An agent run is stuck with nobody working on it',
        evidence:
          `Run ${row.id} is marked running but its worker lease expired ${ago(expiry, ctx.now)} ` +
          `(lease owner: ${row.lease_owner ?? 'none'}). The checkpoint is intact, so it can be resumed.`,
        suggestedFix: 'Put the run back in the queue so the worker picks it up again from its checkpoint.',
        blastRadius: 'safe',
        subjectTable: 'harness_runs',
        subjectId: String(row.id),
        userId: (row.user_id as string | null) ?? null,
        detail: { attempts, maxAttempts, leaseOwner: row.lease_owner ?? null, continuations: row.continuations ?? null },
      });
    }
    return detections;
  },
};

/**
 * Runs the runner gave up on, grouped by cause.
 *
 * The most valuable detector in the set, and the one that justified the whole build: the
 * first live run found 36 dead runs from one caller, all with `attempts: 0`, arriving every
 * couple of hours for eleven days. Nothing surfaced them, because a dead run only writes an
 * `error` column on a row nobody opens.
 *
 * `attempts: 0` is called out in the evidence because it changes the diagnosis completely:
 * a run that died without ever being attempted is not a flaky failure, it is a caller
 * handing the runner something unrunnable.
 */
export const deadLetterDetector: Detector = {
  id: 'harness-run-dead-lettered',
  watches:
    'Agent runs the durable runner dead-lettered, grouped by cause — work that silently stopped and was never told to anyone.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const since = hoursAgo(ctx.now, DEAD_LETTER_LOOKBACK_HOURS);
    const { data, error } = await ctx.supabase
      .from('harness_runs')
      .select('id, user_id, error, attempts, max_attempts, continuations, dead_at, created_at')
      .eq('status', 'dead')
      .gte('dead_at', since)
      .order('dead_at', { ascending: false })
      .limit(SCAN_LIMIT);
    if (error) throw new Error(`harness_runs (dead): ${String(error.message || error)}`);

    const rows = (data ?? []) as Record<string, unknown>[];
    if (!rows.length) return [];

    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const head = errorHead(row.error as string | null);
      const bucket = groups.get(head);
      if (bucket) bucket.push(row);
      else groups.set(head, [row]);
    }

    const detections: Detection[] = [];
    for (const [head, bucket] of groups) {
      const newest = bucket[0];
      const neverAttempted = bucket.every((row) => Number(row.attempts ?? 0) === 0);
      const systemic = bucket.length >= SYSTEMIC_FAILURE_THRESHOLD;
      const tenants = new Set(bucket.map((row) => row.user_id).filter(Boolean));

      /**
       * AN EMPTY PROVIDER ACCOUNT IS NOT A CUSTOMER'S PROBLEM, AND IT MUST NOT READ LIKE ONE.
       *
       * Eight runs in 24 hours across two accounts died with "Insufficient Balance" — our model provider, not
       * the tenant's credits. The generic dead-letter wording ("N agent runs were given up on", "read one
       * run's error") buries the one fact an operator needs: nothing can succeed until somebody tops up the
       * platform account, so every other fix is wasted effort.
       */
      const providerOutOfCredit = /insufficient balance|insufficient_quota|exceeded your current quota|payment required|\b402\b/i.test(
        head
      );

      detections.push({
        class: 'harness-run-dead-lettered',
        severity: providerOutOfCredit ? 'critical' : systemic || neverAttempted ? 'critical' : 'warning',
        title: providerOutOfCredit
          ? 'The platform AI provider account is out of credit — no agent work can run'
          : neverAttempted
            ? 'Agent runs are dying before they are ever attempted'
            : `${bucket.length} agent run(s) were given up on`,
        evidence:
          `${bucket.length} run(s) in the last ${DEAD_LETTER_LOOKBACK_HOURS}h ended dead with the same cause: ` +
          `"${head}". The newest died ${ago(newest.dead_at as string, ctx.now)}` +
          (tenants.size ? `, across ${tenants.size} tenant(s)` : '') +
          (providerOutOfCredit
            ? '. This is the PLATFORM provider account running dry, not any tenant running out of credits — every tenant is affected equally, and no retry can succeed until it is topped up.'
            : neverAttempted
              ? '. Every one of them recorded 0 attempts, so the runner never ran once — this is the caller, not a flaky model call.'
              : '.'),
        suggestedFix: providerOutOfCredit
          ? 'Top up the model-provider account (DeepSeek), then re-queue the affected runs. Customers were shown a spinner, not an error — tell them it was ours.'
          : neverAttempted
            ? 'Read what creates the run (the routine or cron that calls the harness runner) and check it supplies a user message before the session is used.'
            : "Read one run's error and trail, fix the cause, then re-queue the affected runs.",
        blastRadius: 'needs_approval',
        subjectTable: 'harness_runs',
        // The fingerprint belongs to the cause, so the same bug tomorrow is the same incident.
        subjectId: head,
        fingerprintKey: head,
        userId: (newest.user_id as string | null) ?? null,
        detail: {
          cause: head,
          count: bucket.length,
          neverAttempted,
          newestDeadAt: newest.dead_at ?? null,
          runIds: bucket.slice(0, 20).map((row) => row.id),
        },
      });
    }
    return detections;
  },
};

/**
 * Queued runs that nobody claims.
 *
 * Distinct from a stuck run: there the worker died mid-run, here no worker ever looked. The
 * repair is trivial and safe (make the row eligible now instead of at a past time it has
 * already missed), but if this detector fires while `harnessRunnerSilentDetector` also
 * fires, the queue is a symptom and the cron is the disease.
 */
export const queuedStarvedDetector: Detector = {
  id: 'harness-run-queued-starved',
  watches: 'Agent runs waiting in the queue past their own scheduled time, with no worker claiming them.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const cutoff = minutesAgo(ctx.now, QUEUED_STARVED_MINUTES);
    const { data, error } = await ctx.supabase
      .from('harness_runs')
      .select('id, user_id, next_attempt_at, created_at, attempts')
      .eq('status', 'queued')
      .lt('created_at', cutoff)
      .limit(SCAN_LIMIT);
    if (error) throw new Error(`harness_runs (queued): ${String(error.message || error)}`);

    const rows = ((data ?? []) as Record<string, unknown>[]).filter((row) => {
      const due = (row.next_attempt_at ?? row.created_at) as string | null;
      return !due || Date.parse(due) < Date.parse(cutoff);
    });
    if (!rows.length) return [];

    const tenants = new Set(rows.map((row) => row.user_id).filter(Boolean));
    return [
      {
        class: 'harness-run-queued-starved',
        severity: rows.length >= SYSTEMIC_FAILURE_THRESHOLD ? 'critical' : 'warning',
        title: `${rows.length} agent run(s) are queued and nothing is picking them up`,
        evidence:
          `${rows.length} run(s) have been queued for more than ${QUEUED_STARVED_MINUTES} minutes without being ` +
          `claimed${tenants.size ? `, across ${tenants.size} tenant(s)` : ''}. The newest is ` +
          `${ago((rows[0].created_at as string) ?? null, ctx.now)} old.`,
        suggestedFix:
          'Make them eligible again. If this keeps firing every sweep, the per-minute harness runner cron is not running — that is the real fault.',
        blastRadius: 'safe',
        subjectTable: 'harness_runs',
        subjectId: 'queue',
        fingerprintKey: 'queue',
        detail: { count: rows.length, runIds: rows.slice(0, 20).map((row) => row.id) },
      },
    ];
  },
};

/**
 * The drainer itself is dead.
 *
 * `/api/cron/harness-runner` is scheduled every minute. If work is waiting and *nothing* in
 * `harness_runs` has moved for a quarter of an hour, the cron is not running — revoked
 * secret, broken deploy, or a project-level cron failure. Nothing inside the app can fix
 * that, which is exactly why it must be reported loudly: every other agent symptom is a
 * consequence of this one.
 */
export const harnessRunnerSilentDetector: Detector = {
  id: 'harness-runner-silent',
  watches: 'The per-minute agent runner cron: whether anything at all is moving in the run queue.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const cutoff = minutesAgo(ctx.now, RUNNER_SILENT_MINUTES);

    const [queuedCount, newest] = await Promise.all([
      ctx.supabase
        .from('harness_runs')
        .select('id', { count: 'exact', head: true })
        .in('status', ['queued', 'running']),
      ctx.supabase
        .from('harness_runs')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1),
    ]);
    if (queuedCount.error) {
      throw new Error(`harness_runs (count): ${String(queuedCount.error.message || queuedCount.error)}`);
    }
    if (newest.error) throw new Error(`harness_runs (newest): ${String(newest.error.message || newest.error)}`);

    const waiting = Number(queuedCount.count ?? 0);
    if (waiting === 0) return [];

    const lastMovement = ((newest.data ?? []) as { updated_at?: string }[])[0]?.updated_at ?? null;
    if (lastMovement && Date.parse(lastMovement) >= Date.parse(cutoff)) return [];

    return [
      {
        class: 'harness-runner-silent',
        severity: 'critical',
        title: 'The agent runner has stopped running',
        evidence:
          `${waiting} run(s) are waiting and nothing in harness_runs has moved since ${ago(lastMovement, ctx.now)} ` +
          `(threshold ${RUNNER_SILENT_MINUTES}m). The cron is scheduled every minute, so it is not being invoked.`,
        suggestedFix:
          'Check the Vercel cron for /api/cron/harness-runner and the CRON_SECRET it sends; while this is down every agent turn queues and nothing completes.',
        blastRadius: 'needs_approval',
        subjectTable: 'harness_runs',
        subjectId: 'runner',
        fingerprintKey: 'runner',
        detail: { waiting, lastMovement },
      },
    ];
  },
};

// ── 2. renders ───────────────────────────────────────────────────────────────

/**
 * A video task the provider abandoned.
 *
 * `/api/cron/video-watchdog` already re-syncs stale tasks every 20 minutes
 * (`syncVideoTasksForUser`). This detector fires only at 45, i.e. after that watchdog has
 * had two full chances and failed, and it does the one thing the watchdog deliberately will
 * not: it stops the lie. A task left `Processing` forever shows the tenant a spinner that
 * will never resolve, and hides a real failure from support.
 */
export const videoTaskStuckDetector: Detector = {
  id: 'video-task-stuck-processing',
  watches: 'Video render tasks stuck in Processing after the watchdog has already retried them.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const cutoff = minutesAgo(ctx.now, VIDEO_TASK_STUCK_MINUTES);
    const { data, error } = await ctx.supabase
      .from('video_tasks')
      .select('id, user_id, status, updated_at, retry_count, last_error, asset_id, current_index, prompts')
      .eq('status', 'Processing')
      .lt('updated_at', cutoff)
      .limit(SCAN_LIMIT);
    if (error) throw new Error(`video_tasks: ${String(error.message || error)}`);

    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const promptCount = Array.isArray(row.prompts) ? row.prompts.length : 0;
      return {
        class: 'video-task-stuck-processing',
        severity: 'warning',
        title: 'A video render is stuck and the tenant still sees a spinner',
        evidence:
          `Task ${row.id} has been Processing since ${ago(row.updated_at as string, ctx.now)} ` +
          `(limit ${VIDEO_TASK_STUCK_MINUTES}m), retry count ${row.retry_count ?? 0}, ` +
          `scene ${row.current_index ?? 0} of ${promptCount}. The 20-minute watchdog has already swept it twice.` +
          (row.last_error ? ` Last provider error: "${String(row.last_error).slice(0, 120)}".` : ''),
        suggestedFix:
          'Mark the task failed with the reason, so the tenant is told instead of waiting, and the asset is not left mid-render.',
        blastRadius: 'safe',
        subjectTable: 'video_tasks',
        subjectId: String(row.id),
        userId: (row.user_id as string | null) ?? null,
        detail: { retryCount: row.retry_count ?? 0, assetId: row.asset_id ?? null, currentIndex: row.current_index ?? 0 },
      } satisfies Detection;
    });
  },
};

/**
 * An asset stuck mid-render.
 *
 * Report only. `assets.status` is the tenant's own content and their library shows it;
 * rewriting it from a watchdog would be this system making a judgement call about a
 * customer's file. It says what it sees and lets a person decide.
 */
export const assetRenderingStuckDetector: Detector = {
  id: 'asset-stuck-rendering',
  watches: 'Assets left in Rendering long after a render could plausibly still be running.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const cutoff = minutesAgo(ctx.now, ASSET_RENDERING_STUCK_MINUTES);
    const { data, error } = await ctx.supabase
      .from('assets')
      // No `updated_at` on this table — verified against production, and the first run of the
      // verify gate caught the select throwing. `created_at` is the only age signal it has.
      .select('id, user_id, status, created_at, kie_task_id, type')
      .eq('status', 'Rendering')
      .lt('created_at', cutoff)
      .limit(SCAN_LIMIT);
    if (error) throw new Error(`assets (Rendering): ${String(error.message || error)}`);

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      class: 'asset-stuck-rendering',
      severity: 'warning',
      title: 'An asset has been rendering for too long',
      evidence:
        `Asset ${row.id} (${row.type ?? 'unknown type'}) has been in Rendering since ` +
        `${ago(row.created_at as string, ctx.now)}${row.kie_task_id ? `, provider task ${row.kie_task_id}` : ''}.`,
      suggestedFix:
        'Check the provider task, then either finish the asset or mark it failed so the library stops showing an unfinished item.',
      blastRadius: 'needs_approval',
      subjectTable: 'assets',
      subjectId: String(row.id),
      userId: (row.user_id as string | null) ?? null,
      detail: { kieTaskId: row.kie_task_id ?? null, createdAt: row.created_at ?? null },
    }));
  },
};

// ── 3. jobs and locks ────────────────────────────────────────────────────────

/**
 * A site build whose worker lock leaked.
 *
 * `site_build_jobs.locked_until` is a lease: a worker claims a job until a timestamp. If the
 * worker is killed between claim and release, the timestamp stands in the way forever and
 * the tenant's website is never built. Clearing a lock that is already in the past is one of
 * the few writes that cannot make anything worse — it only lets the job be picked up.
 */
export const siteBuildLockLeakedDetector: Detector = {
  id: 'site-build-lock-leaked',
  watches: 'Website build jobs whose worker lock expired without the job finishing.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const cutoff = minutesAgo(ctx.now, SITE_BUILD_LOCKED_MINUTES);
    const { data, error } = await ctx.supabase
      .from('site_build_jobs')
      .select('id, user_id, status, attempts, max_attempts, locked_until, last_error, updated_at')
      .eq('status', 'pending')
      .lt('locked_until', cutoff)
      .limit(SCAN_LIMIT);
    if (error) throw new Error(`site_build_jobs: ${String(error.message || error)}`);

    const detections: Detection[] = [];
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const attempts = Number(row.attempts ?? 0);
      const maxAttempts = Number(row.max_attempts ?? 3);
      const exhausted = attempts >= maxAttempts;

      detections.push({
        class: exhausted ? 'site-build-attempts-exhausted' : 'site-build-lock-leaked',
        severity: exhausted ? 'critical' : 'warning',
        title: exhausted
          ? 'A website build used up every attempt'
          : 'A website build is held by a worker that is gone',
        evidence:
          `Job ${row.id} is pending with a worker lock that expired ${ago(row.locked_until as string, ctx.now)} ` +
          `after ${attempts} of ${maxAttempts} attempts` +
          (row.last_error ? `; last error: "${String(row.last_error).slice(0, 120)}"` : '') +
          '.',
        suggestedFix: exhausted
          ? 'Read the last error before re-running: the same attempt will fail the same way.'
          : 'Clear the stale lock so the next worker pass can claim the job.',
        blastRadius: exhausted ? 'needs_approval' : 'safe',
        subjectTable: 'site_build_jobs',
        subjectId: String(row.id),
        userId: (row.user_id as string | null) ?? null,
        detail: { attempts, maxAttempts, lockedUntil: row.locked_until ?? null },
      });
    }
    return detections;
  },
};

// ── 4. money ─────────────────────────────────────────────────────────────────

/**
 * Credit reservations nobody released.
 *
 * A hold reserves credits against a job (`lib/automation/credit-reconcile.ts`). A hold that
 * expired with `spent = 0` reserved credits and bought nothing, so the tenant's visible
 * balance is lower than what they actually own. Releasing it moves no money — it stops
 * subtracting credits that were never spent.
 *
 * A hold that expired *with* spend is a different animal: the ledger and the hold may now
 * disagree, and only a person can decide. It is split out into its own class on purpose, so
 * the safe repair can never be widened to cover it by accident.
 */
export const creditHoldLeakedDetector: Detector = {
  id: 'credit-hold-leaked',
  watches: "Credit reservations past their expiry that spent nothing, holding a tenant's balance down.",
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const cutoff = minutesAgo(ctx.now, CREDIT_HOLD_STALE_MINUTES);
    const { data, error } = await ctx.supabase
      .from('credit_holds')
      .select('id, user_id, job_id, amount, spent, state, reason, expires_at, created_at')
      .eq('state', 'open')
      .lt('expires_at', cutoff)
      .limit(SCAN_LIMIT);
    if (error) throw new Error(`credit_holds: ${String(error.message || error)}`);

    const detections: Detection[] = [];
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const spent = Number(row.spent ?? 0);
      const amount = Number(row.amount ?? 0);
      const withSpend = spent > 0;

      detections.push({
        class: withSpend ? 'credit-hold-expired-with-spend' : 'credit-hold-leaked',
        severity: withSpend ? 'critical' : 'warning',
        title: withSpend
          ? 'A credit reservation expired after spending, and the ledger may disagree'
          : "A credit reservation is holding a tenant's credits for nothing",
        evidence:
          `Hold ${row.id} for job "${row.job_id}" reserved ${amount} credit(s) and expired ` +
          `${ago(row.expires_at as string, ctx.now)} with ${spent} spent, still in state open.` +
          (withSpend
            ? ' Because something was spent, the hold counter and the ledger have to be compared before anything is closed.'
            : ' Nothing was spent, so the reserved credits should have gone back to the tenant.'),
        suggestedFix: withSpend
          ? 'Reconcile this run against credit_transactions (GET /api/admin/ledger?userId=…) before settling or releasing the hold.'
          : "Release the hold so the tenant's available balance reflects what they own.",
        blastRadius: withSpend ? 'needs_approval' : 'safe',
        subjectTable: 'credit_holds',
        subjectId: String(row.id),
        userId: (row.user_id as string | null) ?? null,
        detail: { amount, spent, jobId: row.job_id ?? null, reason: row.reason ?? null },
      });
    }
    return detections;
  },
};

/**
 * Usage that was recorded but never priced.
 *
 * `usage_events.priced = false` means work happened that nobody has been billed for. Left
 * alone, this is revenue that quietly disappears; the reason it survives is that an unpriced
 * row is invisible everywhere except a billing reconciliation nobody runs.
 *
 * Only rows that CAN be billed are reported. The first version did not check, and its first
 * live run reported ten `kie_video` rows from twelve days earlier — every one with a null
 * `user_id`, null `units` and `cost_inr = 0`. There is no tenant to charge and no quantity to
 * price, so calling that "revenue quietly disappearing" was wrong: those rows are debris from
 * a debugging session, and the correct action is a recorded write-off, not an escalation.
 * (They were written off. See docs/ops-self-healing.md.)
 */
export const unpricedUsageDetector: Detector = {
  id: 'usage-unpriced',
  watches: 'Metered usage that was never priced, grouped by service — work nobody was billed for.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const cutoff = minutesAgo(ctx.now, UNPRICED_USAGE_AFTER_MINUTES);
    const { data, error } = await ctx.supabase
      .from('usage_events')
      .select('id, user_id, service, created_at, units, unit')
      .eq('priced', false)
      // Unbillable rows (no tenant) are debris, not lost revenue. They are written off, and
      // reporting them as an incident would be noise the owner cannot act on.
      .not('user_id', 'is', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(SCAN_LIMIT);
    if (error) throw new Error(`usage_events: ${String(error.message || error)}`);

    const rows = (data ?? []) as Record<string, unknown>[];
    if (!rows.length) return [];

    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const service = String(row.service ?? 'unknown');
      const bucket = groups.get(service);
      if (bucket) bucket.push(row);
      else groups.set(service, [row]);
    }

    return [...groups.entries()].map(([service, bucket]) => ({
      class: 'usage-unpriced',
      severity: 'warning',
      title: `Usage from ${service} was never priced`,
      evidence:
        `${bucket.length} metered event(s) from "${service}" are older than ${UNPRICED_USAGE_AFTER_MINUTES} minutes ` +
        `and still unpriced, the oldest ${ago(bucket[bucket.length - 1].created_at as string, ctx.now)}. ` +
        'That is work the tenant received and was not charged for.',
      suggestedFix:
        'Run the pricing pass over these rows, then confirm the ledger moved; if they cannot be priced, write off and record why.',
      blastRadius: 'needs_approval',
      subjectTable: 'usage_events',
      subjectId: service,
      fingerprintKey: service,
      detail: {
        service,
        count: bucket.length,
        oldest: bucket[bucket.length - 1].created_at ?? null,
        newest: bucket[0].created_at ?? null,
      },
    }));
  },
};

// ── 5. backlogs and the app itself ───────────────────────────────────────────

/**
 * Agent events past their scheduled time.
 *
 * `agent_events` is a shared queue table, and NOT everything in it is work waiting to be
 * drained. Getting that wrong made this detector's first version cry wolf on production:
 *
 *   • `PENDING_ACTION_APPROVAL` rows are a decision waiting for the OWNER. They are supposed
 *     to sit in `pending`, and `expireStaleApprovals` (lib/agent/review-gate.ts) closes them
 *     after 24 hours so they cannot pile up as cards nobody can act on. Four healthy
 *     approvals 90 minutes old were reported as a critical backlog. They are excluded here.
 *   • `/api/cron/agent-events` — the drainer this detector's first version assumed — is
 *     deliberately disabled in this app ("Autonomous lead evaluation agent cron is
 *     disabled"). So a genuinely overdue event of a drainable type will never fix itself,
 *     which makes it MORE worth reporting, not less.
 *
 * The rule that keeps this honest: report only events nobody needs to decide about and no
 * worker is going to pick up.
 */
export const agentEventBacklogDetector: Detector = {
  id: 'agent-event-backlog',
  watches: 'Scheduled agent events that a worker is supposed to drain, sitting past their due time.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const cutoff = minutesAgo(ctx.now, AGENT_EVENT_BACKLOG_MINUTES);
    const { data, error } = await ctx.supabase
      .from('agent_events')
      .select('id, user_id, event_type, status, scheduled_for')
      .eq('status', 'pending')
      // Waiting on a human is not a backlog. See the note above — this exclusion is the
      // difference between a useful alert and one the owner learns to ignore.
      .neq('event_type', 'PENDING_ACTION_APPROVAL')
      .lt('scheduled_for', cutoff)
      .limit(SCAN_LIMIT);
    if (error) throw new Error(`agent_events: ${String(error.message || error)}`);

    const rows = (data ?? []) as Record<string, unknown>[];
    if (!rows.length) return [];

    const tenants = new Set(rows.map((row) => row.user_id).filter(Boolean));
    const types = [...new Set(rows.map((row) => String(row.event_type ?? 'unknown')))];
    return [
      {
        class: 'agent-event-backlog',
        severity: rows.length >= SYSTEMIC_FAILURE_THRESHOLD ? 'critical' : 'warning',
        title: `${rows.length} scheduled agent action(s) are overdue`,
        evidence:
          `${rows.length} pending ${types.join(', ')} event(s) are more than ${AGENT_EVENT_BACKLOG_MINUTES} minutes ` +
          `past their scheduled time${tenants.size ? `, across ${tenants.size} tenant(s)` : ''}.`,
        suggestedFix:
          'These are not approvals, so no human is holding them up: check whether anything still drains this event type, then work the backlog.',
        blastRadius: 'needs_approval',
        subjectTable: 'agent_events',
        subjectId: 'backlog',
        fingerprintKey: 'backlog',
        detail: { count: rows.length, types, eventIds: rows.slice(0, 20).map((row) => row.id) },
      },
    ];
  },
};

/**
 * A business holding more than one standing routine.
 *
 * This is the root cause of the duplicate-runs bug, and it is worth watching even now that a
 * unique index prevents it: the index only covers ENABLED rows, so disabled leftovers can still
 * accumulate, and a future migration that relaxes the index should not be able to reintroduce
 * the behaviour quietly.
 *
 * Why duplicates were expensive: the routine-run idempotency key is `(routine_id, period_key)`,
 * so each extra routine row got its own key and the daily cron queued one run per row per
 * period. Measured before the fix: six runs for one tenant on a single day.
 *
 * Reported, never repaired. Deleting a customer's configuration is a decision, not a repair —
 * and the harmless half of the problem is already neutralised in `materialiseDueRoutines`,
 * which queues at most one run per business per sweep.
 */
export const duplicateRoutineRowsDetector: Detector = {
  id: 'routine-duplicate-rows',
  watches: 'Businesses holding more than one standing routine, which used to mean one run per row per day.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const { data, error } = await ctx.supabase
      .from('business_routines')
      .select('id, user_id, name, enabled, created_at')
      .limit(SCAN_LIMIT);
    if (error) {
      // A fresh install has no routines table yet; that is not an incident.
      if (/does not exist|schema cache/i.test(String(error.message || ''))) return [];
      throw new Error(`business_routines: ${String(error.message || error)}`);
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const byUser = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const userId = String(row.user_id ?? '');
      if (!userId) continue;
      const bucket = byUser.get(userId);
      if (bucket) bucket.push(row);
      else byUser.set(userId, [row]);
    }

    const detections: Detection[] = [];
    for (const [userId, bucket] of byUser) {
      if (bucket.length < 2) continue;
      const enabledCount = bucket.filter((row) => row.enabled).length;
      const names = bucket.map((row) => `"${row.name}"${row.enabled ? '' : ' (disabled)'}`).join(', ');
      detections.push({
        class: 'routine-duplicate-rows',
        severity: enabledCount > 1 ? 'critical' : 'warning',
        title: 'A business has more than one standing routine',
        evidence:
          `This business holds ${bucket.length} routine rows: ${names}. ` +
          (enabledCount > 1
            ? `${enabledCount} of them are enabled, which the unique index should have refused.`
            : 'Only the oldest is used, so the rest are dead configuration.'),
        suggestedFix:
          'Keep the routine the business actually means and delete or disable the others. The cron already queues at most one run per business, so nothing is at risk meanwhile.',
        blastRadius: 'needs_approval',
        subjectTable: 'business_routines',
        subjectId: userId,
        userId,
        detail: { count: bucket.length, enabledCount, routineIds: bucket.map((row) => row.id), names: bucket.map((row) => row.name) },
      });
    }
    return detections;
  },
};

/**
 * Is the app even up?
 *
 * Every other detector reads the database, and the database can be perfectly healthy while
 * the app is returning 500s to customers. This one asks the running deployment directly. It
 * probes with a real GET (not HEAD) because a serverless route can 200 a HEAD and fail the
 * handler, and it treats a slow answer as its own warning: a 9-second dashboard is a
 * production incident at launch even if the status code is 200.
 */
export const appReachabilityDetector: Detector = {
  id: 'app-unreachable',
  watches: 'The deployed app answering real requests: status code and time to first byte.',
  async run(ctx: DetectorContext): Promise<Detection[]> {
    const base = ctx.config.appUrl;
    if (!base) return [];

    const url = base.replace(/\/+$/, '') + '/';
    const started = Date.now();
    let status = 0;
    let failure: string | null = null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APP_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'user-agent': 'nobogent-ops-watchdog/1' },
        cache: 'no-store',
      });
      status = response.status;
      // Drain the body: a route that cannot finish writing is not up, and leaving the socket
      // half-read makes the next probe look worse than it is.
      await response.text();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }

    const elapsed = Date.now() - started;

    if (failure) {
      return [
        {
          class: 'app-unreachable',
          severity: 'critical',
          title: 'The app did not answer',
          evidence: `GET ${url} failed after ${elapsed}ms: ${failure}.`,
          suggestedFix:
            'Check the current Vercel deployment and its runtime logs; a failed deploy or a crashing route makes every page and every cron unavailable.',
          blastRadius: 'needs_approval',
          subjectTable: 'platform',
          subjectId: 'app',
          fingerprintKey: 'app',
          detail: { url, elapsed, failure },
        },
      ];
    }

    if (status >= 500) {
      return [
        {
          class: 'app-unreachable',
          severity: 'critical',
          title: `The app is returning ${status}`,
          evidence: `GET ${url} answered ${status} in ${elapsed}ms.`,
          suggestedFix: 'Read the Vercel runtime log for this route and deploy a fix; customers are seeing this error.',
          blastRadius: 'needs_approval',
          subjectTable: 'platform',
          subjectId: 'app',
          fingerprintKey: 'app',
          detail: { url, status, elapsed },
        },
      ];
    }

    if (elapsed > APP_PROBE_TIMEOUT_MS / 2) {
      return [
        {
          class: 'app-slow',
          severity: 'warning',
          title: 'The app is answering slowly',
          evidence: `GET ${url} answered ${status} but took ${elapsed}ms (half the ${APP_PROBE_TIMEOUT_MS}ms budget).`,
          suggestedFix: 'Look at cold starts and slow queries before launch traffic makes this worse.',
          blastRadius: 'needs_approval',
          subjectTable: 'platform',
          subjectId: 'latency',
          fingerprintKey: 'latency',
          detail: { url, status, elapsed },
        },
      ];
    }

    // A 404 here is still an answer: the deployment is up. Only 5xx and silence are incidents.
    return [];
  },
};

/** Every detector, in the order the board presents them: agents, renders, jobs, money, platform. */
export const DETECTORS: readonly Detector[] = [
  leaseExpiredDetector,
  deadLetterDetector,
  queuedStarvedDetector,
  harnessRunnerSilentDetector,
  videoTaskStuckDetector,
  assetRenderingStuckDetector,
  siteBuildLockLeakedDetector,
  creditHoldLeakedDetector,
  unpricedUsageDetector,
  agentEventBacklogDetector,
  duplicateRoutineRowsDetector,
  appReachabilityDetector,
];
