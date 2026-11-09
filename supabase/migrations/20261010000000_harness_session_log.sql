-- Migration: Harness session event log
--
-- The harness UI is a VIEW over a durable, append-only event log, projected by
-- pure folds. This replaces the previous design where the client was the owner
-- of chat state (useChat + localStorage), which is why sessions could not be
-- listed, resumed, replayed, or shared between devices.
--
-- Deliberately separate from `public.agent_events`, which is the autonomous
-- sales agent's JOB QUEUE (lead_id + scheduled_for + status), not a chat log.

-- ── sessions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.harness_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL DEFAULT 'default',
    title TEXT NOT NULL DEFAULT 'New session',
    -- 'idle' | 'running' | 'error' — the state dot in the sidebar tree
    status TEXT NOT NULL DEFAULT 'idle',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harness_sessions_user_updated
    ON public.harness_sessions(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_harness_sessions_workspace
    ON public.harness_sessions(user_id, workspace_id, updated_at DESC);

-- ── events (append-only) ────────────────────────────────────────────────────
-- `seq` is per-session and monotonic; (session_id, seq) is unique so a retried
-- append can never duplicate a turn. `data` is the event payload; projections
-- fold them in `seq` order.
CREATE TABLE IF NOT EXISTS public.harness_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.harness_sessions(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL,
    type TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT harness_events_session_seq_unique UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_harness_events_session_seq
    ON public.harness_events(session_id, seq);

-- ── workspaces (sidebar grouping) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.harness_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harness_workspaces_user
    ON public.harness_workspaces(user_id, created_at ASC);

-- ── append helper ───────────────────────────────────────────────────────────
-- Allocates the next `seq` for a session and inserts the event atomically, so
-- concurrent tool-call appends cannot interleave into a duplicate seq.
CREATE OR REPLACE FUNCTION public.harness_append_event(
    p_session_id UUID,
    p_type TEXT,
    p_data JSONB DEFAULT '{}'::jsonb
) RETURNS public.harness_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_seq BIGINT;
    v_row public.harness_events;
BEGIN
    SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.harness_events
    WHERE session_id = p_session_id;

    INSERT INTO public.harness_events (session_id, seq, type, data)
    VALUES (p_session_id, v_seq, p_type, p_data)
    RETURNING * INTO v_row;

    UPDATE public.harness_sessions
    SET updated_at = NOW()
    WHERE id = p_session_id;

    RETURN v_row;
END;
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.harness_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harness_sessions_owner" ON public.harness_sessions;
CREATE POLICY "harness_sessions_owner" ON public.harness_sessions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "harness_events_owner" ON public.harness_events;
CREATE POLICY "harness_events_owner" ON public.harness_events
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.harness_sessions s
            WHERE s.id = harness_events.session_id AND s.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.harness_sessions s
            WHERE s.id = harness_events.session_id AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "harness_workspaces_owner" ON public.harness_workspaces;
CREATE POLICY "harness_workspaces_owner" ON public.harness_workspaces
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
