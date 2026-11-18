-- Migration: create a durable run already claimed, in one round trip, and only
-- for a session the caller owns.
--
-- Why this exists
-- ---------------
-- The streaming route creates a run and immediately takes its lease. It used to
-- do that as two statements (an INSERT, then an UPDATE) and only after a third
-- statement had confirmed the session belonged to the caller. All three are on
-- the path to the first token, and the first two are a write.
--
-- This folds the ownership check INTO the insert: the INSERT ... SELECT simply
-- produces no row when the session is not the caller's, so the caller gets NULL
-- and nothing is created. One round trip instead of three.
--
-- SECURITY INVOKER on purpose (the default). The function must run as the
-- caller, not as its owner, so that RLS still applies to both tables:
--   * harness_sessions is only visible to its owner, so a foreign session id
--     yields no source row;
--   * harness_runs has a WITH CHECK (auth.uid() = user_id) insert policy, so a
--     caller cannot create a run stamped with somebody else's user_id.
-- Marking this SECURITY DEFINER would bypass both and turn it into a way to
-- make another tenant's session run work.
--
-- The worker is unaffected: harness_claim_run still only takes `queued` runs, or
-- `running` ones whose lease has expired — which is exactly what should happen
-- if the request that created this row dies mid-turn.

CREATE OR REPLACE FUNCTION public.harness_create_claimed_run(
    p_session_id UUID,
    p_user_id UUID,
    p_goal TEXT,
    p_worker TEXT,
    p_lease_seconds INT DEFAULT 300,
    p_idempotency_key TEXT DEFAULT NULL,
    p_priority INT DEFAULT 0,
    p_deadline_at TIMESTAMPTZ DEFAULT NULL
) RETURNS public.harness_runs
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row public.harness_runs;
BEGIN
    INSERT INTO public.harness_runs (
        session_id,
        user_id,
        goal,
        status,
        priority,
        deadline_at,
        idempotency_key,
        lease_owner,
        lease_expires_at,
        last_heartbeat_at,
        started_at,
        updated_at
    )
    SELECT
        s.id,
        p_user_id,
        p_goal,
        'running',
        COALESCE(p_priority, 0),
        COALESCE(p_deadline_at, NOW() + INTERVAL '6 hours'),
        p_idempotency_key,
        p_worker,
        NOW() + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 300), 1)),
        NOW(),
        NOW(),
        NOW()
    FROM public.harness_sessions s
    WHERE s.id = p_session_id
      AND s.user_id = p_user_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.harness_create_claimed_run(UUID, UUID, TEXT, TEXT, INT, TEXT, INT, TIMESTAMPTZ) IS
    'Insert a harness_runs row already running and leased to p_worker, but only if p_session_id belongs to p_user_id. Returns NULL otherwise. Callers: POST /api/agent/v2/runs/stream.';
