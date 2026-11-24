-- Migration: a run's deadline has to follow its progress
--
-- WHY THIS EXISTS
-- deadline_at is stamped once at enqueue (created_at + 6 hours) and was never moved
-- again — not when a slice made progress, not when the worker requeued the run, and
-- not when an operator revived a dead one. A run therefore burned its budget in wall
-- clock time since creation, including time it spent waiting on something that was not
-- its own fault, and was killed on the original clock no matter how much of the budget
-- its own work had actually used.
--
-- Measured in production on 2026-11-24, account f0ae1d0b: seven runs were blocked
-- 07:01-07:05 by our own empty model-provider wallet ("Insufficient Balance", five
-- attempts each, logged in harness_events). They were revived at ~14:54 once the wallet
-- was topped up, but harness_revive_run cleared status/attempts/error and left
-- deadline_at at its original 13:01 value. The reaper then dead-lettered all seven at
-- 14:59:08 — thirteen seconds after they became runnable again — with "Deadline
-- exceeded." Not one of them executed a single new slice; attempts stayed 0.
--
-- WHAT CHANGES
--   * One pure helper owns the rule, so both call sites and the gate agree.
--   * finish_run, when it requeues ('queued'), grants a fresh window from NOW(). A run
--     that keeps producing slices keeps earning time — this is the "checkpoint and
--     continue" behaviour, rather than being killed mid-task.
--   * revive_run gives a dead run a working window again, which is what made the seven
--     runs above die on arrival.
--
-- WHAT DOES NOT CHANGE
-- The ceiling. Every extension is clamped to created_at + 24 hours, so this cannot
-- create a run that lives forever: a run that stops making progress still dies when its
-- window lapses, and no run outlives a day.

-- ── the rule, in one place ──────────────────────────────────────────────────
-- Pure (takes p_now explicitly) so it is testable without waiting for a clock:
--   extended = max(old deadline, now + budget)
--   capped   = min(created_at + ceiling, extended)
-- "max" is why an extension never shortens a deadline that is already further out.
CREATE OR REPLACE FUNCTION public.harness_run_deadline_after_progress(
    p_created_at TIMESTAMPTZ,
    p_deadline_at TIMESTAMPTZ,
    p_now TIMESTAMPTZ,
    p_budget_seconds INT DEFAULT 21600,
    p_ceiling_seconds INT DEFAULT 86400
) RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT LEAST(
        p_created_at + make_interval(secs => p_ceiling_seconds),
        GREATEST(
            COALESCE(p_deadline_at, p_now),
            p_now + make_interval(secs => p_budget_seconds)
        )
    );
$$;

-- ── requeue grants a fresh window ───────────────────────────────────────────
-- Same signature as before: replacing in place, so no overload is created and every
-- existing caller keeps working.
CREATE OR REPLACE FUNCTION public.harness_finish_run(
    p_run_id UUID,
    p_worker TEXT,
    p_status TEXT,
    p_checkpoint JSONB DEFAULT NULL,
    p_error TEXT DEFAULT NULL,
    p_bump_continuation BOOLEAN DEFAULT TRUE,
    p_next_attempt_at TIMESTAMPTZ DEFAULT NULL,
    p_increment_attempt BOOLEAN DEFAULT FALSE
) RETURNS public.harness_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.harness_runs;
BEGIN
    IF p_status NOT IN ('completed', 'failed', 'cancelled', 'queued', 'dead') THEN
        RAISE EXCEPTION 'invalid finish status: %', p_status;
    END IF;

    UPDATE public.harness_runs
    SET status = p_status,
        checkpoint = COALESCE(p_checkpoint, checkpoint),
        error = p_error,
        continuations = continuations + CASE WHEN p_bump_continuation THEN 1 ELSE 0 END,
        attempts = attempts + CASE WHEN p_increment_attempt THEN 1 ELSE 0 END,
        next_attempt_at = p_next_attempt_at,
        -- A requeued run still has work to do, so its window restarts. A terminal
        -- status leaves the deadline alone: nothing will read it again.
        deadline_at = CASE
            WHEN p_status = 'queued'
                THEN public.harness_run_deadline_after_progress(created_at, deadline_at, NOW())
            ELSE deadline_at
        END,
        dead_at = CASE WHEN p_status = 'dead' THEN NOW() ELSE dead_at END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        finished_at = CASE WHEN p_status IN ('completed', 'failed', 'cancelled', 'dead') THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE id = p_run_id
      AND lease_owner = p_worker
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

-- ── reviving a dead run gives it a window, not an expired one ────────────────
-- The old deadline is deliberately not passed through: it is in the past (or the run
-- would not have been dead), so a revived run starts a clean window under the same cap.
CREATE OR REPLACE FUNCTION public.harness_revive_run(p_run_id UUID)
RETURNS public.harness_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.harness_runs;
BEGIN
    UPDATE public.harness_runs
    SET status = 'queued',
        attempts = 0,
        error = NULL,
        dead_at = NULL,
        next_attempt_at = NULL,
        deadline_at = public.harness_run_deadline_after_progress(created_at, NULL, NOW()),
        lease_owner = NULL,
        lease_expires_at = NULL,
        finished_at = NULL,
        updated_at = NOW()
    WHERE id = p_run_id
      AND status IN ('dead', 'failed')
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;
