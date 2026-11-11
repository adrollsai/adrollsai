/**
 * Durable run queue: enqueue, claim, heartbeat, checkpoint, finish, cancel.
 *
 * Standard durable-job semantics:
 *   - claims are atomic (`SKIP LOCKED`), so concurrent workers never collide
 *   - a claim carries a lease; a crashed worker's run becomes claimable again
 *   - the slice writes a checkpoint back, so the next worker resumes the exact
 *     model conversation rather than restarting the task
 *   - cancellation is cooperative and checked between model steps
 *
 * Tables: supabase/migrations/20261011000000_harness_runs.sql
 */
import type { SupabaseClient } from '@supabase/supabase-js';

type Db = SupabaseClient<any, 'public', any>;

function db(supabase: SupabaseClient): Db {
  return supabase as unknown as Db;
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead';

export interface HarnessRun {
  id: string;
  session_id: string;
  user_id: string;
  status: RunStatus;
  goal: string | null;
  checkpoint: { messages?: unknown[]; slices?: number } | null;
  continuations: number;
  max_continuations: number;
  /** Failed attempts (retries), distinct from slices completed. */
  attempts: number;
  max_attempts: number;
  /** Backoff gate: the run is not claimable before this time. */
  next_attempt_at: string | null;
  dead_at: string | null;
  /** Higher runs first. */
  priority: number;
  /** Hard wall-clock ceiling; past this the reaper dead-letters the run. */
  deadline_at: string | null;
  /** Client key making enqueue idempotent. */
  idempotency_key: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  cancel_requested: boolean;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface RunSummary {
  id: string;
  sessionId: string;
  status: RunStatus;
  goal: string | null;
  continuations: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  priority: number;
  deadlineAt: string | null;
  cancelRequested: boolean;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export function toSummary(run: HarnessRun): RunSummary {
  return {
    id: run.id,
    sessionId: run.session_id,
    status: run.status,
    goal: run.goal,
    continuations: run.continuations,
    attempts: run.attempts,
    maxAttempts: run.max_attempts,
    nextAttemptAt: run.next_attempt_at,
    priority: run.priority ?? 0,
    deadlineAt: run.deadline_at ?? null,
    cancelRequested: run.cancel_requested,
    error: run.error,
    createdAt: run.created_at,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
  };
}

const MISSING_TABLE = new Set(['42P01', 'PGRST205', 'PGRST202']);

function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && MISSING_TABLE.has(error.code)) return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('could not find the table') || msg.includes('could not find the function');
}

/** True once the runs migration is applied. Cached per process. */
let runsAvailable: boolean | undefined;
export async function runsAvailableCheck(supabase: SupabaseClient): Promise<boolean> {
  if (runsAvailable !== undefined) return runsAvailable;
  const { error } = await db(supabase).from('harness_runs').select('id').limit(1);
  runsAvailable = !isMissing(error);
  if (!runsAvailable) {
    console.warn(
      '[Harness] harness_runs table not found — durable background runs are disabled. ' +
        'Apply supabase/migrations/20261011000000_harness_runs.sql.'
    );
  }
  return runsAvailable;
}

export function __resetRunsAvailabilityCacheForTests(): void {
  runsAvailable = undefined;
}

/**
 * Queue a new run for a session.
 *
 * Idempotent when `idempotencyKey` is supplied: a double-submit (impatient user,
 * retried fetch, duplicated webhook) resolves to the SAME run instead of
 * creating a second one that would spend the same money twice.
 */
export async function enqueueRun(
  supabase: SupabaseClient,
  input: {
    sessionId: string;
    userId: string;
    goal: string;
    idempotencyKey?: string;
    priority?: number;
    /** Absolute deadline; defaults to now + 6 hours. */
    deadlineAt?: string;
    maxAttempts?: number;
  }
): Promise<HarnessRun | null> {
  const deadline = input.deadlineAt ?? new Date(Date.now() + 6 * 60 * 60_000).toISOString();

  const { data, error } = await db(supabase)
    .from('harness_runs')
    .insert({
      session_id: input.sessionId,
      user_id: input.userId,
      goal: input.goal,
      status: 'queued',
      priority: input.priority ?? 0,
      deadline_at: deadline,
      idempotency_key: input.idempotencyKey ?? null,
      ...(input.maxAttempts ? { max_attempts: input.maxAttempts } : {}),
    })
    .select('*')
    .single();

  if (error) {
    // Same key, same session → return the run that already exists.
    if (error.code === '23505' && input.idempotencyKey) {
      const { data: existing } = await db(supabase)
        .from('harness_runs')
        .select('*')
        .eq('session_id', input.sessionId)
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();
      if (existing) {
        console.log(`[Harness] enqueue is idempotent — reusing run ${(existing as any).id.slice(0, 8)}`);
        return existing as HarnessRun;
      }
    }
    if (!isMissing(error)) console.error('[Harness] enqueueRun failed:', error.message);
    return null;
  }

  return data as HarnessRun;
}

/**
 * Claim the next run for this worker: an expired-lease run first (crash
 * recovery), otherwise the oldest queued one. Returns null when idle.
 */
export async function claimRun(
  supabase: SupabaseClient,
  worker: string,
  leaseSeconds = 300,
  maxPerUser = 2,
  maxTotal = 8
): Promise<HarnessRun | null> {
  const { data, error } = await db(supabase).rpc('harness_claim_run', {
    p_worker: worker,
    p_lease_seconds: leaseSeconds,
    p_max_per_user: maxPerUser,
    p_max_total: maxTotal,
  });

  if (error) {
    if (!isMissing(error)) console.error('[Harness] claimRun failed:', error.message);
    return null;
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0] as HarnessRun | null | undefined;
  // Same caveat as finishRun: an all-NULLs composite means "nothing claimed".
  if (!row || !row.id) return null;
  return row;
}

/** Extend the lease during a slice. Returns false if the lease was stolen. */
export async function heartbeatRun(
  supabase: SupabaseClient,
  runId: string,
  worker: string,
  leaseSeconds = 300
): Promise<boolean> {
  const { data, error } = await db(supabase).rpc('harness_heartbeat_run', {
    p_run_id: runId,
    p_worker: worker,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    if (!isMissing(error)) console.error('[Harness] heartbeatRun failed:', error.message);
    return false;
  }
  return Boolean(data);
}

/**
 * End a slice. `status: 'queued'` means "not finished, run me again" — that is
 * what turns bounded slices into hours-long work.
 */
export async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  worker: string,
  outcome: {
    status: 'completed' | 'failed' | 'cancelled' | 'queued' | 'dead';
    checkpoint?: { messages: unknown[]; slices: number } | null;
    error?: string | null;
    bumpContinuation?: boolean;
    /** Schedule the next attempt (retry backoff). */
    nextAttemptAt?: string | null;
    /** Count this as a failed attempt, driving max_attempts. */
    incrementAttempt?: boolean;
  }
): Promise<HarnessRun | null> {
  const { data, error } = await db(supabase).rpc('harness_finish_run', {
    p_run_id: runId,
    p_worker: worker,
    p_status: outcome.status,
    p_checkpoint: outcome.checkpoint ?? null,
    p_error: outcome.error ?? null,
    p_bump_continuation: outcome.bumpContinuation ?? true,
    p_next_attempt_at: outcome.nextAttemptAt ?? null,
    p_increment_attempt: outcome.incrementAttempt ?? false,
  });

  if (error) {
    if (!isMissing(error)) console.error('[Harness] finishRun failed:', error.message);
    return null;
  }

  // PostgREST returns a composite row of all NULLs (not JSON null) when the
  // SQL function returns NULL — i.e. when the lease-owner guard rejected us.
  // Treat that as a real failure, otherwise a stolen/expired lease looks like
  // a successful finish.
  const row = (Array.isArray(data) ? data[0] : data) as HarnessRun | null | undefined;
  if (!row || !row.id) return null;
  return row;
}

/** Owner-initiated cancel. The worker observes it between steps. */
export async function requestCancel(
  supabase: SupabaseClient,
  runId: string,
  userId: string
): Promise<boolean> {
  // A run that is still QUEUED has not been claimed, so there is nothing to interrupt:
  // setting the cooperative flag alone left it queued forever, which meant the chat
  // stayed blocked and every later message was refused as "run in progress". Close it
  // here. A run that is already RUNNING is left to the worker, which checks the flag
  // between steps and stops at a clean boundary.
  try {
    const { data: current } = await db(supabase)
      .from('harness_runs')
      .select('status')
      .eq('id', runId)
      .eq('user_id', userId)
      .maybeSingle();

    const status = String((current as any)?.status || '');
    const nowIso = new Date().toISOString();

    if (status === 'queued' || status === 'retrying') {
      const { error } = await db(supabase)
        .from('harness_runs')
        .update({
          status: 'cancelled',
          cancel_requested: true,
          finished_at: nowIso,
          error: 'Cancelled before it started.',
          updated_at: nowIso,
        })
        .eq('id', runId)
        .eq('user_id', userId);
      if (error) {
        console.warn('[Harness] requestCancel (queued) failed:', error.message);
        return false;
      }
      return true;
    }

    const { error } = await db(supabase)
      .from('harness_runs')
      .update({ cancel_requested: true, updated_at: nowIso })
      .eq('id', runId)
      .eq('user_id', userId);
    if (error) {
      console.warn('[Harness] requestCancel failed:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[Harness] requestCancel threw:', err?.message || err);
    return false;
  }
}


/** Has the owner asked for this run to stop? Polled between model steps. */
export async function isCancelRequested(
  supabase: SupabaseClient,
  runId: string
): Promise<boolean> {
  const { data, error } = await db(supabase)
    .from('harness_runs')
    .select('cancel_requested, status')
    .eq('id', runId)
    .maybeSingle();

  if (error || !data) return false;
  return Boolean(data.cancel_requested) || data.status === 'cancelled';
}

export async function getRun(
  supabase: SupabaseClient,
  runId: string,
  userId: string
): Promise<HarnessRun | null> {
  const { data, error } = await db(supabase)
    .from('harness_runs')
    .select('*')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data as HarnessRun;
}

/** Most recent runs for a session — drives the "queued / running" indicator. */
export async function listRunsForSession(
  supabase: SupabaseClient,
  sessionId: string,
  limit = 10
): Promise<RunSummary[]> {
  const { data, error } = await db(supabase)
    .from('harness_runs')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as HarnessRun[]).map(toSummary);
}

// ── retry policy ───────────────────────────────────────────────────────────
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 5 * 60_000;

/**
 * Exponential backoff with ±20% jitter, capped at 5 minutes.
 * Jitter matters: without it every failed run retries in lockstep and hammers
 * the provider at the same instant.
 */
export function nextBackoffMs(attemptsSoFar: number): number {
  const exponential = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attemptsSoFar)));
  const jitter = 0.8 + Math.random() * 0.4;
  // Clamp AFTER jitter — otherwise the ceiling would be CAP × 1.2, not CAP.
  return Math.min(BACKOFF_CAP_MS, Math.round(exponential * jitter));
}

/** Requeue a run that exhausted its retries so an operator can try again. */
export async function reviveRun(
  supabase: SupabaseClient,
  runId: string
): Promise<HarnessRun | null> {
  const { data, error } = await db(supabase).rpc('harness_revive_run', { p_run_id: runId });
  if (error) {
    if (!isMissing(error)) console.error('[Harness] reviveRun failed:', error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as HarnessRun | null | undefined;
  if (!row || !row.id) return null;
  return row;
}

// ── tool-call ledger (exactly-once side effects) ───────────────────────────
export interface ToolCallRecord {
  id: string;
  run_id: string;
  session_id: string;
  tool_name: string;
  input_hash: string;
  status: 'started' | 'completed' | 'failed';
  output: unknown;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export type ToolCallLookup =
  /** Never seen in this run — we just claimed it, execute it. */
  | { state: 'fresh'; record: ToolCallRecord | null }
  /** Already ran; replay this result instead of executing again. */
  | { state: 'completed'; record: ToolCallRecord }
  /** Another slice is running it right now. */
  | { state: 'in_flight'; record: ToolCallRecord }
  /** Started long ago with no result — the side effect may or may not have landed. */
  | { state: 'unknown_outcome'; record: ToolCallRecord };

const DEFAULT_STALE_MS = 10 * 60_000;

/**
 * Claim a tool call for this run, or discover it already happened.
 *
 * The whole point: if a slice crashes after a side-effecting tool ran but before
 * the checkpoint was written, the resumed slice must not fire it a second time.
 */
export async function beginToolCall(
  supabase: SupabaseClient,
  params: {
    runId: string;
    sessionId: string;
    toolName: string;
    inputHash: string;
    input: unknown;
    staleAfterMs?: number;
  }
): Promise<ToolCallLookup> {
  const staleAfterMs = params.staleAfterMs ?? DEFAULT_STALE_MS;

  const read = async (): Promise<ToolCallRecord | null> => {
    const { data } = await db(supabase)
      .from('harness_tool_calls')
      .select('*')
      .eq('run_id', params.runId)
      .eq('tool_name', params.toolName)
      .eq('input_hash', params.inputHash)
      .maybeSingle();
    return (data as ToolCallRecord) || null;
  };

  const classify = (record: ToolCallRecord): ToolCallLookup => {
    if (record.status === 'completed' || record.status === 'failed') {
      return { state: 'completed', record };
    }
    const age = Date.now() - new Date(record.created_at).getTime();
    return age < staleAfterMs
      ? { state: 'in_flight', record }
      : { state: 'unknown_outcome', record };
  };

  const existing = await read();
  if (existing) return classify(existing);

  const { data: inserted, error } = await db(supabase)
    .from('harness_tool_calls')
    .insert({
      run_id: params.runId,
      session_id: params.sessionId,
      tool_name: params.toolName,
      input_hash: params.inputHash,
      input: params.input as any,
      status: 'started',
    })
    .select('*')
    .single();

  if (error) {
    // Lost the race to another slice — re-read and classify.
    if (error.code === '23505') {
      const winner = await read();
      if (winner) return classify(winner);
    }
    if (!isMissing(error)) console.error('[Harness] beginToolCall failed:', error.message);
    // The caller decides what a missing ledger means; for side effects we treat
    // it as unsafe rather than silently allowing a duplicate.
    return { state: 'fresh', record: null };
  }

  return { state: 'fresh', record: (inserted as ToolCallRecord) || null };
}

/**
 * Persist the loop state mid-slice.
 *
 * Called from `prepareStep`, i.e. at the boundary between steps. This shrinks
 * the crash window to a single in-flight step: anything already completed is in
 * the checkpoint, so a resumed slice never re-issues a tool call that already
 * ran. Without it, whole slices could be replayed.
 */
export async function saveCheckpoint(
  supabase: SupabaseClient,
  runId: string,
  messages: unknown[],
  sliceNumber: number
): Promise<void> {
  const { error } = await db(supabase)
    .from('harness_runs')
    .update({
      checkpoint: { messages, slices: sliceNumber },
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);

  if (error && !isMissing(error)) {
    console.warn('[Harness] saveCheckpoint failed:', error.message);
  }
}

/** Record the outcome so a retried slice replays it instead of re-executing. */
export async function finishToolCall(
  supabase: SupabaseClient,
  id: string,
  outcome: { status: 'completed' | 'failed'; output?: unknown; error?: string | null }
): Promise<void> {
  const { error } = await db(supabase)
    .from('harness_tool_calls')
    .update({
      status: outcome.status,
      output: (outcome.output ?? null) as any,
      error: outcome.error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error && !isMissing(error)) {
    console.error('[Harness] finishToolCall failed:', error.message);
  }
}

/**
 * How many times this exact call has already been recorded for the run.
 *
 * Two identical tool calls in one run are legitimate (send the same reminder
 * twice); a *retried* slice re-issuing the same call is not. The event log
 * tells the difference: every completed step persists its tool calls, so the
 * Nth occurrence is stable across a crash and a retry.
 */
export async function countPriorToolCalls(
  supabase: SupabaseClient,
  sessionId: string,
  toolName: string,
  inputHash: string,
  hashOf: (input: unknown) => string
): Promise<number> {
  const { data, error } = await db(supabase)
    .from('harness_events')
    .select('data')
    .eq('session_id', sessionId)
    .eq('type', 'tool.call')
    .order('seq', { ascending: true })
    .limit(5000);

  if (error || !data) return 0;

  let count = 0;
  for (const row of data as Array<{ data: any }>) {
    const d = row.data || {};
    if (d.name !== toolName) continue;
    if (hashOf(d.input) === inputHash) count++;
  }
  return count;
}

// ── housekeeping + observability ───────────────────────────────────────────
export interface ReapResult {
  reapedDeadline: number;
  reapedStuck: number;
}

/** Dead-letter runs past their deadline, and runs whose worker vanished with
 *  its retry budget spent. Cheap enough to run on every worker tick. */
export async function reapRuns(supabase: SupabaseClient): Promise<ReapResult> {
  const { data, error } = await db(supabase).rpc('harness_reap_runs');
  if (error) {
    if (!isMissing(error)) console.error('[Harness] reapRuns failed:', error.message);
    return { reapedDeadline: 0, reapedStuck: 0 };
  }
  const row = (Array.isArray(data) ? data[0] : data) || {};
  return {
    reapedDeadline: Number(row.reaped_deadline ?? 0),
    reapedStuck: Number(row.reaped_stuck ?? 0),
  };
}

/**
 * Is there queued or in-flight work for this session?
 *
 * Used to tell the difference between "a run is working" and "a status was left
 * at 'running' because the browser went away mid-stream".
 */
export async function hasLiveRun(
  supabase: SupabaseClient,
  sessionId: string
): Promise<boolean> {
  const { count, error } = await db(supabase)
    .from('harness_runs')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .in('status', ['queued', 'running']);

  if (error) return false;
  return (count ?? 0) > 0;
}

export interface QueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  dead: number;
  overdue_retries: number;
  oldest_queued_age_seconds: number;
  expired_leases: number;
  total: number;
}

export async function queueStats(supabase: SupabaseClient): Promise<QueueStats | null> {
  const { data, error } = await db(supabase).rpc('harness_queue_stats');
  if (error) {
    if (!isMissing(error)) console.error('[Harness] queueStats failed:', error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as QueueStats | null;
  return row || null;
}
