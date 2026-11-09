-- Migration: harden the durable run engine to production standard
--
-- Adds the four things the first version was missing:
--   1. retries with exponential backoff, max attempts, and a dead-letter state
--   2. a tool-call ledger, so a crashed slice cannot re-fire a side effect
--   3. per-user (and global) concurrency limits enforced inside the claim
--   4. Realtime publication, so the browser is pushed events instead of polling

-- ── 1. retry / dead-letter columns ──────────────────────────────────────────
ALTER TABLE public.harness_runs
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dead_at TIMESTAMPTZ;

-- 'dead' joins the state machine: work that exhausted its retries.
DO $$
BEGIN
    -- Drop an old check constraint if one was ever created, then allow 'dead'.
    ALTER TABLE public.harness_runs DROP CONSTRAINT IF EXISTS harness_runs_status_check;
EXCEPTION WHEN undefined_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_harness_runs_dead
    ON public.harness_runs(dead_at)
    WHERE status = 'dead';

-- ── 2. tool-call ledger (exactly-once side effects) ────────────────────────
-- One row per (run, tool, input hash). A slice that crashes after a tool ran
-- but before the checkpoint was written would otherwise repeat the call on
-- resume — re-sending a WhatsApp message or launching a campaign twice.
--
-- status:
--   started   — claimed, outcome unknown (a crash here is the dangerous case)
--   completed — result recorded; replayed on retry, never re-executed
--   failed    — recorded failure; replayed like completed
CREATE TABLE IF NOT EXISTS public.harness_tool_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES public.harness_runs(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.harness_sessions(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    input JSONB,
    status TEXT NOT NULL DEFAULT 'started',
    output JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT harness_tool_calls_unique UNIQUE (run_id, tool_name, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_harness_tool_calls_run
    ON public.harness_tool_calls(run_id, created_at);

-- ── 3. claim: honour backoff and concurrency limits ────────────────────────
-- Replaces the v1 claim. A run is only claimable when:
--   * its retry time has arrived (next_attempt_at)
--   * the owning user has fewer than p_max_per_user live runs
--     (one tenant cannot starve the queue)
--
-- The old 2-argument signature MUST be dropped: adding a parameter would
-- otherwise create an *overload*, and a 2-arg call would become ambiguous.
DROP FUNCTION IF EXISTS public.harness_claim_run(TEXT, INT);

CREATE OR REPLACE FUNCTION public.harness_claim_run(
    p_worker TEXT,
    p_lease_seconds INT DEFAULT 300,
    p_max_per_user INT DEFAULT 2
) RETURNS SETOF public.harness_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Prefer reclaiming a run whose worker died.
    SELECT r.id INTO v_id
    FROM public.harness_runs r
    WHERE r.status = 'running'
      AND (r.lease_expires_at IS NULL OR r.lease_expires_at < NOW())
      AND (
        SELECT count(*) FROM public.harness_runs r2
        WHERE r2.user_id = r.user_id
          AND r2.status = 'running'
          AND r2.lease_expires_at > NOW()
      ) < p_max_per_user
    ORDER BY r.lease_expires_at NULLS FIRST
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_id IS NULL THEN
        SELECT r.id INTO v_id
        FROM public.harness_runs r
        WHERE r.status = 'queued'
          AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= NOW())
          AND (
            SELECT count(*) FROM public.harness_runs r2
            WHERE r2.user_id = r.user_id
              AND r2.status = 'running'
              AND r2.lease_expires_at > NOW()
          ) < p_max_per_user
        ORDER BY r.updated_at
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

-- ── 4. finish: support scheduling a retry and dead-lettering ───────────────
-- p_next_attempt_at schedules the next try; p_increment_attempt records that
-- this was a failed attempt (drives the backoff and the max_attempts ceiling).
DROP FUNCTION IF EXISTS public.harness_finish_run(UUID, TEXT, TEXT, JSONB, TEXT, BOOLEAN);

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

-- ── 5. operator recovery from the dead-letter state ────────────────────────
-- Explicit, owner-initiated requeue so a run that exhausted its retries can be
-- retried deliberately after the cause is understood.
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

-- ── RLS for the ledger ─────────────────────────────────────────────────────
ALTER TABLE public.harness_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harness_tool_calls_owner_select" ON public.harness_tool_calls;
CREATE POLICY "harness_tool_calls_owner_select" ON public.harness_tool_calls
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.harness_sessions s
            WHERE s.id = harness_tool_calls.session_id AND s.user_id = auth.uid()
        )
    );

-- ── 6. Realtime ────────────────────────────────────────────────────────────
-- Push log and run changes to the browser so it stops polling. Guarded because
-- the publication may not exist on a bare Postgres.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_events;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_runs;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

-- Realtime needs the full row to deliver UPDATE payloads usefully.
ALTER TABLE public.harness_events REPLICA IDENTITY FULL;
ALTER TABLE public.harness_runs REPLICA IDENTITY FULL;
