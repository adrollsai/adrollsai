-- Migration: complete the run engine (production tier)
--
-- Closes the remaining gaps:
--   * idempotent enqueue — a double-submit cannot create two paid runs
--   * priority ordering and a per-run wall-clock deadline
--   * a global concurrency ceiling alongside the per-user one
--   * a reaper for stuck leases and over-deadline runs
--   * a queue-health view for operators

-- ── 1. new run fields ──────────────────────────────────────────────────────
ALTER TABLE public.harness_runs
    ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ,
    -- Client-supplied key. Two submits with the same key are the same run.
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- At most one run per (session, key). NULL keys are unconstrained, so existing
-- rows and callers that do not supply a key keep working.
CREATE UNIQUE INDEX IF NOT EXISTS idx_harness_runs_idempotent
    ON public.harness_runs(session_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_harness_runs_priority
    ON public.harness_runs(status, priority DESC, updated_at)
    WHERE status IN ('queued', 'running');

-- ── 2. claim: priority + global ceiling + deadline awareness ───────────────
-- Signature changes again, so the 3-argument version must go or calls become
-- ambiguous overloads.
DROP FUNCTION IF EXISTS public.harness_claim_run(TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.harness_claim_run(
    p_worker TEXT,
    p_lease_seconds INT DEFAULT 300,
    p_max_per_user INT DEFAULT 2,
    p_max_total INT DEFAULT 8
) RETURNS SETOF public.harness_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
    v_running_total INT;
BEGIN
    SELECT count(*) INTO v_running_total
    FROM public.harness_runs
    WHERE status = 'running' AND lease_expires_at > NOW();

    IF v_running_total >= p_max_total THEN
        RETURN;
    END IF;

    -- 1. reclaim a run whose worker died (highest priority first)
    SELECT r.id INTO v_id
    FROM public.harness_runs r
    WHERE r.status = 'running'
      AND (r.lease_expires_at IS NULL OR r.lease_expires_at < NOW())
      AND (r.deadline_at IS NULL OR r.deadline_at > NOW())
      AND (
        SELECT count(*) FROM public.harness_runs r2
        WHERE r2.user_id = r.user_id
          AND r2.status = 'running'
          AND r2.lease_expires_at > NOW()
      ) < p_max_per_user
    ORDER BY r.priority DESC, r.lease_expires_at NULLS FIRST
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    -- 2. otherwise the next queued run, respecting retry backoff
    IF v_id IS NULL THEN
        SELECT r.id INTO v_id
        FROM public.harness_runs r
        WHERE r.status = 'queued'
          AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= NOW())
          AND (r.deadline_at IS NULL OR r.deadline_at > NOW())
          AND (
            SELECT count(*) FROM public.harness_runs r2
            WHERE r2.user_id = r.user_id
              AND r2.status = 'running'
              AND r2.lease_expires_at > NOW()
          ) < p_max_per_user
        ORDER BY r.priority DESC, r.updated_at
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

-- ── 3. reaper ──────────────────────────────────────────────────────────────
-- Housekeeping the worker runs before claiming. Without it, a run whose deadline
-- passed while nobody was working would sit queued forever, and a run whose
-- worker died with its retries spent would stay 'running' for good.
CREATE OR REPLACE FUNCTION public.harness_reap_runs()
RETURNS TABLE(reaped_deadline INT, reaped_stuck INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deadline INT := 0;
    v_stuck INT := 0;
BEGIN
    WITH killed AS (
        UPDATE public.harness_runs
        SET status = 'dead',
            error = COALESCE(error, 'Deadline exceeded.'),
            dead_at = NOW(),
            finished_at = NOW(),
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE status IN ('queued', 'running')
          AND deadline_at IS NOT NULL
          AND deadline_at <= NOW()
        RETURNING 1
    )
    SELECT count(*) INTO v_deadline FROM killed;

    WITH killed AS (
        UPDATE public.harness_runs
        SET status = 'dead',
            error = COALESCE(
                error,
                'Worker disappeared and the retry budget was spent.'
            ),
            dead_at = NOW(),
            finished_at = NOW(),
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE status = 'running'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < NOW() - make_interval(secs => 60)
          AND attempts >= max_attempts
        RETURNING 1
    )
    SELECT count(*) INTO v_stuck FROM killed;

    RETURN QUERY SELECT v_deadline, v_stuck;
END;
$$;

-- ── 4. operator queue health ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.harness_queue_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v JSONB;
BEGIN
    SELECT jsonb_build_object(
        'queued', count(*) FILTER (WHERE status = 'queued'),
        'running', count(*) FILTER (WHERE status = 'running'),
        'completed', count(*) FILTER (WHERE status = 'completed'),
        'failed', count(*) FILTER (WHERE status = 'failed'),
        'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
        'dead', count(*) FILTER (WHERE status = 'dead'),
        'overdue_retries', count(*) FILTER (WHERE status = 'queued' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW()),
        'oldest_queued_age_seconds',
            COALESCE(EXTRACT(EPOCH FROM (NOW() - min(created_at) FILTER (WHERE status = 'queued')))::INT, 0),
        'expired_leases', count(*) FILTER (WHERE status = 'running' AND lease_expires_at < NOW()),
        'total', count(*)
    ) INTO v
    FROM public.harness_runs;
    RETURN v;
END;
$$;
