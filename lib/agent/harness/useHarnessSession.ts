'use client';

/**
 * Client binding for the harness session log.
 *
 * The log is authoritative and lives on the server; this hook only reads the
 * projection and appends events. That is the whole difference from the old
 * design, where `useChat` + localStorage made the browser the owner of the
 * conversation and made sessions impossible to list or resume.
 *
 * Session ownership is always the authenticated operator (auth.uid()), which is
 * what Supabase RLS can actually enforce. Impersonation changes the agent's
 * business context, not who owns the conversation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HarnessState } from './projection';
import type { HarnessEvent } from './events';
import type { RunSummary } from './runs';
import { createClient as createBrowserClient } from '@/utils/supabase/client';

export interface HarnessSessionSummary {
  id: string;
  title: string;
  workspaceId: string;
  status: 'idle' | 'running' | 'error';
  updatedAt: string;
}

export interface HarnessWorkspace {
  id: string;
  name: string;
}

export interface UseHarnessSession {
  /** null while the first probe is in flight. */
  available: boolean | null;
  sessions: HarnessSessionSummary[];
  workspaces: HarnessWorkspace[];
  activeId: string | null;
  state: HarnessState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createSession: (opts?: { title?: string; workspaceId?: string }) => Promise<string | null>;
  /** Returns the freshly projected state so callers can rebuild model context. */
  openSession: (id: string) => Promise<HarnessState | null>;
  removeSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  /** Optimistically append a human message, then persist it. */
  appendUserMessage: (
    text: string,
    attachments?: Array<{ name: string; url?: string; type: string; size?: number }>,
    /** Explicit target — required when the session was created in this tick and
     *  the hook's internal ref has not re-rendered yet. */
    forSessionId?: string
  ) => Promise<string | null>;
  /** Merge a fresh projection pushed by the caller (e.g. after a completed run). */
  setProjectedState: (next: HarnessState | null) => void;
  /** Tail the log from the last seen seq — resumes a run the tab did not watch. */
  syncFromLog: () => Promise<HarnessEvent[]>;

  // ── durable background runs ────────────────────────────────────────────
  /** Latest run for the open session, if any. */
  activeRun: RunSummary | null;
  /** Queue a durable run. Returns immediately; a worker advances it. */
  startRun: (message: string, opts?: { goal?: string; attachments?: unknown[] }) => Promise<RunSummary | null>;
  /** Ask the current run to stop at its next step boundary. */
  cancelRun: () => Promise<void>;
  /** Re-read the projection without disturbing the model context. */
  refreshProjection: () => Promise<HarnessState | null>;
  /** True while a run is queued or being worked on. */
  runInProgress: boolean;
}

const genId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

/** Realtime channel teardown that never throws during unmount. */
function supabaseUnsubscribe(channel: any) {
  try {
    void channel.unsubscribe();
  } catch {
    /* already gone */
  }
}

/**
 * Idempotency key for enqueue: same message in the same session within the same
 * minute is ONE run. A double-click or an auto-retried fetch collapses; a
 * deliberate re-send a minute later is a new run.
 */
function enqueueKey(sessionId: string, message: string): string {
  const bucket = Math.floor(Date.now() / 60_000);
  let hash = 0;
  const raw = `${sessionId}\u0000${bucket}\u0000${message}`;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `enq_${bucket}_${(hash >>> 0).toString(36)}`;
}

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

export function useHarnessSession(): UseHarnessSession {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<HarnessSessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<HarnessWorkspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<HarnessState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastSeqRef = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const refresh = useCallback(async () => {
    try {
      const body = await jsonFetch('/api/agent/v2/sessions');
      setAvailable(Boolean(body.available));
      setSessions(Array.isArray(body.sessions) ? body.sessions : []);
      setWorkspaces(Array.isArray(body.workspaces) ? body.workspaces : []);
      setError(null);
    } catch (err: any) {
      // A failure here must not break the harness: the caller can fall back.
      setAvailable(false);
      setError(err?.message || 'Could not load sessions');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openSession = useCallback(async (id: string): Promise<HarnessState | null> => {
    setLoading(true);
    try {
      const body = await jsonFetch(`/api/agent/v2/sessions/${id}`);
      const nextState = body.state as HarnessState;
      setActiveId(id);
      setState(nextState);
      const events: HarnessEvent[] = Array.isArray(body.events) ? body.events : [];
      lastSeqRef.current = events.reduce((max, e) => Math.max(max, e.seq || 0), 0);
      setError(null);

      // Re-attach to a run that is still going.
      //
      // activeRun lived only in this tab's memory, so reopening (or opening on
      // another device) showed a transcript with no sign that the agent was
      // still working. Ask the server what is actually in flight.
      try {
        const runsBody = await jsonFetch(`/api/agent/v2/runs?sessionId=${encodeURIComponent(id)}`);
        const runs: RunSummary[] = Array.isArray(runsBody.runs) ? runsBody.runs : [];
        const live = runs.find((r) => r.status === 'queued' || r.status === 'running') || null;
        setActiveRun(live);
      } catch {
        /* runs endpoint unavailable — leave whatever we had */
      }

      return nextState;
    } catch (err: any) {
      setError(err?.message || 'Could not open session');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const createSession = useCallback(
    async (opts?: { title?: string; workspaceId?: string }) => {
      try {
        const body = await jsonFetch('/api/agent/v2/sessions', {
          method: 'POST',
          body: JSON.stringify({
            title: opts?.title,
            workspaceId: opts?.workspaceId,
          }),
        });
        const summary = body.session as HarnessSessionSummary;
        setSessions((prev) => [summary, ...prev]);
        setActiveId(summary.id);
        setState(null);
        lastSeqRef.current = 0;
        await openSession(summary.id);
        setError(null);
        return summary.id;
      } catch (err: any) {
        setError(err?.message || 'Could not create session');
        return null;
      }
    },
    [openSession]
  );

  const removeSession = useCallback(
    async (id: string) => {
      try {
        await jsonFetch(`/api/agent/v2/sessions/${id}`, { method: 'DELETE' });
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeIdRef.current === id) {
          setActiveId(null);
          setState(null);
          lastSeqRef.current = 0;
        }
      } catch (err: any) {
        setError(err?.message || 'Could not delete session');
      }
    },
    []
  );

  const renameSession = useCallback(async (id: string, title: string) => {
    try {
      await jsonFetch(`/api/agent/v2/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    } catch (err: any) {
      setError(err?.message || 'Could not rename session');
    }
  }, []);

  const createWorkspace = useCallback(async (name: string) => {
    try {
      const body = await jsonFetch('/api/agent/v2/sessions', {
        method: 'POST',
        body: JSON.stringify({ kind: 'workspace', name }),
      });
      if (body.workspace) setWorkspaces((prev) => [...prev, body.workspace]);
    } catch (err: any) {
      setError(err?.message || 'Could not create workspace');
    }
  }, []);

  const appendUserMessage = useCallback(
    async (
      text: string,
      attachments?: Array<{ name: string; url?: string; type: string; size?: number }>,
      forSessionId?: string
    ) => {
      const id = genId();
      const sessionId = forSessionId || activeIdRef.current;
      if (!sessionId) return null;

      // Optimistic: the projection is the same fold the server will do, so the
      // row is identical once the log is reloaded.
      setState((prev) => {
        const base =
          prev ??
          ({
            sessionId,
            title: 'New session',
            workspaceId: 'default',
            status: 'idle',
            items: [],
            toolIndex: {},
            seenIds: {},
            resolvedCalls: {},
            version: 0,
          } as HarnessState);
        return {
          ...base,
          items: [...base.items, { kind: 'user', id, text, attachments }],
          seenIds: { ...base.seenIds, [id]: true },
          version: base.version + 1,
        };
      });

      try {
        await jsonFetch(`/api/agent/v2/sessions/${sessionId}/events`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'user.message',
            data: { id, text, attachments },
          }),
        });
      } catch (err: any) {
        setError(err?.message || 'Could not save your message to the log');
      }

      return id;
    },
    []
  );

  const syncFromLog = useCallback(async () => {
    const sessionId = activeIdRef.current;
    if (!sessionId) return [];
    try {
      const body = await jsonFetch(
        `/api/agent/v2/sessions/${sessionId}/events?after=${lastSeqRef.current}`
      );
      const events: HarnessEvent[] = Array.isArray(body.events) ? body.events : [];
      if (events.length) {
        lastSeqRef.current = events.reduce((max, e) => Math.max(max, e.seq || 0), lastSeqRef.current);
      }
      return events;
    } catch {
      return [];
    }
  }, []);

  // ── durable runs ─────────────────────────────────────────────────────────
  const [activeRun, setActiveRun] = useState<RunSummary | null>(null);

  /** Re-read the projection only — leaves the model conversation untouched. */
  const refreshProjection = useCallback(async (): Promise<HarnessState | null> => {
    const sessionId = activeIdRef.current;
    if (!sessionId) return null;
    try {
      const body = await jsonFetch(`/api/agent/v2/sessions/${sessionId}`);
      const next = body.state as HarnessState;
      setState(next);
      const events: HarnessEvent[] = Array.isArray(body.events) ? body.events : [];
      lastSeqRef.current = events.reduce((max, e) => Math.max(max, e.seq || 0), 0);
      return next;
    } catch {
      return null;
    }
  }, []);

  const startRun = useCallback(
    async (message: string, opts?: { goal?: string; attachments?: unknown[] }) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return null;
      try {
        const body = await jsonFetch('/api/agent/v2/runs', {
          method: 'POST',
          body: JSON.stringify({
            sessionId,
            message,
            goal: opts?.goal,
            attachments: opts?.attachments,
            messageId: genId(),
            idempotencyKey: enqueueKey(sessionId, message),
          }),
        });
        const run = body.run as RunSummary;
        setActiveRun(run);
        setError(null);
        return run;
      } catch (err: any) {
        setError(err?.message || 'Could not start the background run');
        return null;
      }
    },
    []
  );

  const cancelRun = useCallback(async () => {
    const run = activeRun;
    if (!run) return;
    try {
      await jsonFetch(`/api/agent/v2/runs/${run.id}`, { method: 'DELETE' });
      setActiveRun({ ...run, cancelRequested: true });
    } catch (err: any) {
      setError(err?.message || 'Could not cancel the run');
    }
  }, [activeRun]);

  const runInProgress = Boolean(activeRun && (activeRun.status === 'queued' || activeRun.status === 'running'));

  // ── live updates ─────────────────────────────────────────────────────────
  // Preferred: Supabase Realtime pushes `harness_events` inserts and
  // `harness_runs` changes, so the transcript appears as the worker writes it.
  // Fallback: polling, used when Realtime is unavailable or fails to subscribe.
  const [realtimeOk, setRealtimeOk] = useState<boolean | null>(null);

  useEffect(() => {
    const sessionId = activeId;
    if (!sessionId) {
      setRealtimeOk(null);
      return;
    }

    let channel: any;
    let disposed = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void (async () => {
          await refreshProjection();
          if (activeRun?.id) {
            try {
              const body = await jsonFetch(`/api/agent/v2/runs/${activeRun.id}`);
              if (!disposed && body.run) setActiveRun(body.run as RunSummary);
            } catch {
              /* ignore */
            }
          }
        })();
      }, 250);
    };

    try {
      const supabase = createBrowserClient();
      channel = supabase
        .channel(`harness_session_${sessionId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'harness_events', filter: `session_id=eq.${sessionId}` },
          scheduleRefresh
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'harness_runs', filter: `session_id=eq.${sessionId}` },
          scheduleRefresh
        )
        .subscribe((status: string) => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') setRealtimeOk(true);
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeOk(false);
        });
    } catch {
      setRealtimeOk(false);
    }

    return () => {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      if (channel) supabaseUnsubscribe(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, refreshProjection]);

  // Poll only as a fallback (or to catch a run's status when nothing else moves).
  useEffect(() => {
    if (!runInProgress || !activeRun) return;
    const sessionId = activeIdRef.current;
    if (!sessionId) return;

    let stopped = false;
    const intervalMs = realtimeOk === true ? 20_000 : 4_000;

    const tick = async () => {
      if (stopped) return;
      if (realtimeOk !== true) {
        const fresh = await syncFromLog();
        if (fresh.length) await refreshProjection();
      }
      try {
        const body = await jsonFetch(`/api/agent/v2/runs/${activeRun.id}`);
        if (!stopped && body.run) setActiveRun(body.run as RunSummary);
      } catch {
        /* transient — next tick will retry */
      }
    };

    const timer = setInterval(tick, intervalMs);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runInProgress, activeRun, realtimeOk, syncFromLog, refreshProjection]);

  return {
    available,
    sessions,
    workspaces,
    activeId,
    state,
    loading,
    error,
    refresh,
    createSession,
    openSession,
    removeSession,
    renameSession,
    createWorkspace,
    appendUserMessage,
    setProjectedState: setState,
    syncFromLog,
    activeRun,
    startRun,
    cancelRun,
    refreshProjection,
    runInProgress,
  };
}
