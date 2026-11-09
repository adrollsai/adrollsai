-- Migration: durable long-running agent runs
--
-- Why this exists: an agent turn used to live entirely inside one HTTP request,
-- so it died at the platform's request limit (60s, then 300s) and anything the
-- model was mid-way through was lost. Hours-long work needs the run decoupled
-- from the request.
--
-- This is the standard durable-job pattern (pg-boss / Oban / River shaped):
--   * a queue table with explicit status transitions
--   * atomic claiming via SELECT ... FOR UPDATE SKIP LOCKED, so N workers never
--     process the same run
--   * a lease with an expiry, so a crashed worker's run becomes claimable again
--   * a JSONB checkpoint on the run row, so the next slice resumes the exact
--     model conversation instead of restarting the task
--   * cooperative cancellation, checked between model steps

CREATE TABLE IF NOT EXISTS public.harness_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.harness_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- queued | running | completed | failed | cancelled
    status TEXT NOT NULL DEFAULT 'queued',

    -- What the run is trying to achieve. Kept on the row so a continuation
    -- slice can re-state it even if the log has been compacted.
    goal TEXT,

    -- Loop state: the model conversation as of the end of the last slice.
    -- { messages: ModelMessage[], slices: number }
    checkpoint JSONB,

    -- How many slices this run has needed. A cap stops a runaway loop.
    continuations INT NOT NULL DEFAULT 0,
    max_continuations INT NOT NULL DEFAULT 500,

    -- Lease: who is working on it and until when. Expired lease => claimable.
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ,

    cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
    error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The claim query walks queued work oldest-first, and expired leases first.
-- Ordering is by `updated_at`, not `created_at`: re-queueing a run bumps
-- `updated_at`, which pushes it to the BACK of the queue so one long task
-- cannot monopolise the worker (the same idea as an SQS visibility timeout).
CREATE INDEX IF NOT EXISTS idx_harness_runs_claimable
    ON public.harness_runs(status, updated_at)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_harness_runs_session
    ON public.harness_runs(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_harness_runs_user
    ON public.harness_runs(user_id, created_at DESC);

-- ── claim ───────────────────────────────────────────────────────────────────
-- Two-phase claim, both under FOR UPDATE SKIP LOCKED:
--   1. a run whose lease expired (the previous worker died) — highest priority
--   2. otherwise the oldest queued run
-- Returns at most one row. `attempts` counts slices, not retries.
CREATE OR REPLACE FUNCTION public.harness_claim_run(
    p_worker TEXT,
    p_lease_seconds INT DEFAULT 300
) RETURNS SETOF public.harness_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    SELECT id INTO v_id
    FROM public.harness_runs
    WHERE status = 'running'
      AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
    ORDER BY lease_expires_at NULLS FIRST
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_id IS NULL THEN
        SELECT id INTO v_id
        FROM public.harness_runs
        WHERE status = 'queued'
        ORDER BY updated_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1;
    END IF;

    IF v_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE public.harness_runs
    SET status = 'running',
        lease_owner = p_worker,
        lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
        last_heartbeat_at = NOW(),
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
    WHERE id = v_id
    RETURNING *;
END;
$$;

-- Extend the lease while a slice is running, so a long slice is not stolen.
CREATE OR REPLACE FUNCTION public.harness_heartbeat_run(
    p_run_id UUID,
    p_worker TEXT,
    p_lease_seconds INT DEFAULT 300
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INT;
BEGIN
    UPDATE public.harness_runs
    SET lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE id = p_run_id
      AND lease_owner = p_worker
      AND status = 'running';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

-- Finish a slice. Both terminal states and re-queueing for the next slice go
-- through here, so the lease is always released exactly once.
CREATE OR REPLACE FUNCTION public.harness_finish_run(
    p_run_id UUID,
    p_worker TEXT,
    p_status TEXT,               -- completed | failed | cancelled | queued
    p_checkpoint JSONB DEFAULT NULL,
    p_error TEXT DEFAULT NULL,
    p_bump_continuation BOOLEAN DEFAULT TRUE
) RETURNS public.harness_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.harness_runs;
BEGIN
    IF p_status NOT IN ('completed', 'failed', 'cancelled', 'queued') THEN
        RAISE EXCEPTION 'invalid finish status: %', p_status;
    END IF;

    UPDATE public.harness_runs
    SET status = p_status,
        checkpoint = COALESCE(p_checkpoint, checkpoint),
        error = p_error,
        continuations = continuations + CASE WHEN p_bump_continuation THEN 1 ELSE 0 END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        finished_at = CASE WHEN p_status IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE id = p_run_id
      AND lease_owner = p_worker
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.harness_runs ENABLE ROW LEVEL SECURITY;

-- Owners may enqueue and watch/cancel their own runs. The worker uses the
-- service role, which bypasses RLS.
DROP POLICY IF EXISTS "harness_runs_owner_select" ON public.harness_runs;
CREATE POLICY "harness_runs_owner_select" ON public.harness_runs
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "harness_runs_owner_insert" ON public.harness_runs;
CREATE POLICY "harness_runs_owner_insert" ON public.harness_runs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "harness_runs_owner_update" ON public.harness_runs;
CREATE POLICY "harness_runs_owner_update" ON public.harness_runs
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
