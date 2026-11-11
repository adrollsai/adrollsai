/**
 * Harness session store — the only place that touches the event log tables.
 *
 * Server-side only (RLS still applies: every query runs as the caller).
 * Tables are created by supabase/migrations/20261010000000_harness_session_log.sql;
 * until that migration is applied, `isAvailable()` returns false and callers
 * degrade to an in-memory session instead of throwing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseEvent, type HarnessEvent, type HarnessEventType } from './events';
import { project, type HarnessState } from './projection';

/** The generated Database types predate these tables; keep the cast in one place. */
type Db = SupabaseClient<any, 'public', any>;

function db(supabase: SupabaseClient): Db {
  return supabase as unknown as Db;
}

export interface HarnessSessionRow {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  status: 'idle' | 'running' | 'error';
  created_at: string;
  updated_at: string;
}

export interface HarnessSessionSummary {
  id: string;
  title: string;
  workspaceId: string;
  status: 'idle' | 'running' | 'error';
  updatedAt: string;
  eventCount?: number;
}

const MISSING_TABLE = new Set(['42P01', 'PGRST205', 'PGRST202']);

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && MISSING_TABLE.has(error.code)) return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('could not find the table');
}

/** True once the migration is applied. Cached per process to avoid a probe per request. */
let availability: boolean | undefined;
export async function isAvailable(supabase: SupabaseClient): Promise<boolean> {
  if (availability !== undefined) return availability;
  const { error } = await db(supabase).from('harness_sessions').select('id').limit(1);
  availability = !isMissingTable(error);
  if (!availability) {
    console.warn(
      '[Harness] harness_sessions table not found — run supabase/migrations/20261010000000_harness_session_log.sql. ' +
        'Falling back to ephemeral sessions.'
    );
  }
  return availability;
}

/**
 * Test-only: clear the cached availability probe so a fresh fake client can be
 * evaluated. Never call this from application code.
 */
export function __resetAvailabilityCacheForTests(): void {
  availability = undefined;
}

export async function listSessions(
  supabase: SupabaseClient,
  userId: string,
  opts: { workspaceId?: string; limit?: number } = {}
): Promise<HarnessSessionSummary[]> {
  let q = db(supabase)
    .from('harness_sessions')
    .select('id, title, workspace_id, status, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.workspaceId) q = q.eq('workspace_id', opts.workspaceId);

  const { data, error } = await q;
  if (error) {
    if (!isMissingTable(error)) {
      console.error('[Harness] listSessions failed:', error.message);
    }
    return [];
  }

  return (data || []).map((r: any) => ({
    id: r.id,
    title: r.title,
    workspaceId: r.workspace_id,
    status: r.status,
    updatedAt: r.updated_at,
  }));
}

export async function createSession(
  supabase: SupabaseClient,
  userId: string,
  opts: { title?: string; workspaceId?: string } = {}
): Promise<HarnessSessionSummary | null> {
  const title = (opts.title || 'New session').slice(0, 200);
  const workspaceId = opts.workspaceId || 'default';

  const { data, error } = await db(supabase)
    .from('harness_sessions')
    .insert({ user_id: userId, title, workspace_id: workspaceId, status: 'idle' })
    .select('id, title, workspace_id, status, updated_at')
    .single();

  if (error || !data) {
    if (!isMissingTable(error)) console.error('[Harness] createSession failed:', error?.message);
    return null;
  }

  await appendEvent(supabase, data.id, 'session.opened', { title, workspaceId });

  return {
    id: data.id,
    title: data.title,
    workspaceId: data.workspace_id,
    status: data.status,
    updatedAt: data.updated_at,
  };
}

/** Append one event. Uses the SQL helper so `seq` allocation is atomic. */
export async function appendEvent(
  supabase: SupabaseClient,
  sessionId: string,
  type: HarnessEventType,
  data: Record<string, unknown>
): Promise<boolean> {
  const { error } = await db(supabase).rpc('harness_append_event', {
    p_session_id: sessionId,
    p_type: type,
    p_data: data,
  });

  if (error) {
    if (!isMissingTable(error)) {
      console.error(`[Harness] appendEvent(${type}) failed:`, error.message);
    }
    return false;
  }
  return true;
}

/** Append several events in order. Best-effort: returns how many landed. */
export async function appendEvents(
  supabase: SupabaseClient,
  sessionId: string,
  events: Array<{ type: HarnessEventType; data: Record<string, unknown> }>
): Promise<number> {
  let ok = 0;
  for (const e of events) {
    if (await appendEvent(supabase, sessionId, e.type, e.data)) ok++;
  }
  return ok;
}

export async function loadEvents(
  supabase: SupabaseClient,
  sessionId: string,
  afterSeq = 0
): Promise<HarnessEvent[]> {
  const { data, error } = await db(supabase)
    .from('harness_events')
    .select('seq, type, data, created_at')
    .eq('session_id', sessionId)
    .gt('seq', afterSeq)
    .order('seq', { ascending: true })
    .limit(5000);

  if (error) {
    if (!isMissingTable(error)) console.error('[Harness] loadEvents failed:', error.message);
    return [];
  }

  return (data || [])
    .map((row: any) =>
      parseEvent({ seq: row.seq, type: row.type, data: row.data, created_at: row.created_at })
    )
    .filter((e): e is HarnessEvent => e !== null);
}

export interface LoadedSession {
  session: HarnessSessionRow;
  events: HarnessEvent[];
  state: HarnessState;
}

/** Load a session, its full log, and the projection of that log. */
export async function loadSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<LoadedSession | null> {
  const { data, error } = await db(supabase)
    .from('harness_sessions')
    .select('id, user_id, workspace_id, title, status, created_at, updated_at')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (!isMissingTable(error)) console.error('[Harness] loadSession failed:', error.message);
    return null;
  }
  if (!data) return null;

  const events = await loadEvents(supabase, sessionId);
  const state = project(sessionId, events);

  return { session: data as HarnessSessionRow, events, state };
}

export async function renameSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  title: string
): Promise<boolean> {
  const clean = title.trim().slice(0, 200);
  if (!clean) return false;

  const { error } = await db(supabase)
    .from('harness_sessions')
    .update({ title: clean, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', userId);

  if (error) {
    if (!isMissingTable(error)) console.error('[Harness] renameSession failed:', error.message);
    return false;
  }

  await appendEvent(supabase, sessionId, 'session.titled', { title: clean });
  return true;
}

export async function setSessionStatus(
  supabase: SupabaseClient,
  sessionId: string,
  status: 'idle' | 'running' | 'error'
): Promise<boolean> {
  const { error } = await db(supabase)
    .from('harness_sessions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) {
    if (!isMissingTable(error)) console.error('[Harness] setSessionStatus failed:', error.message);
    return false;
  }
  return true;
}

export async function deleteSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<boolean> {
  // Delete children first. `harness_events` and `harness_runs` reference the
  // session, and without an ON DELETE CASCADE the delete is rejected by the
  // foreign key — which surfaced in the UI as a delete button that did nothing,
  // because the route reported success and the row reappeared on refresh.
  const children: Array<{ table: string; column: string }> = [
    { table: 'harness_events', column: 'session_id' },
    { table: 'harness_runs', column: 'session_id' },
  ];
  for (const child of children) {
    const { error: childError } = await db(supabase)
      .from(child.table)
      .delete()
      .eq(child.column, sessionId);
    if (childError && !isMissingTable(childError)) {
      console.error(`[Harness] deleteSession could not clear ${child.table}:`, childError.message);
      return false;
    }
  }

  const { error } = await db(supabase)
    .from('harness_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId);

  if (error) {
    if (!isMissingTable(error)) console.error('[Harness] deleteSession failed:', error.message);
    return false;
  }
  return true;
}

export async function listWorkspaces(supabase: SupabaseClient, userId: string) {
  const { data, error } = await db(supabase)
    .from('harness_workspaces')
    .select('id, name, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    if (!isMissingTable(error)) console.error('[Harness] listWorkspaces failed:', error.message);
    return [];
  }
  return (data || []).map((r: any) => ({ id: r.id as string, name: r.name as string }));
}

export async function createWorkspace(supabase: SupabaseClient, userId: string, name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) return null;

  const { data, error } = await db(supabase)
    .from('harness_workspaces')
    .insert({ user_id: userId, name: clean })
    .select('id, name')
    .single();

  if (error) {
    if (!isMissingTable(error)) console.error('[Harness] createWorkspace failed:', error.message);
    return null;
  }
  return { id: data.id as string, name: data.name as string };
}
