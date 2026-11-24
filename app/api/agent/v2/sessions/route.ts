import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolveActingUser } from '@/utils/route-auth';
import {
  isAvailable,
  listSessions,
  createSession,
  listWorkspaces,
  createWorkspace,
  ensureCeoSession,
} from '@/lib/agent/harness/store';

export const maxDuration = 30;

/**
 * Whose harness the agent tab shows.
 *
 * A super admin inspecting a tenant appends ?impersonate=<uuid>; the id is only
 * accepted from a caller that may act for that account (super_admin always,
 * agency/admin for their own sub-accounts). Without this the tab listed the super
 * admin's own threads and workspaces while the switcher said otherwise.
 */
async function actingUserIdFor(req: Request, bodyImpersonate?: unknown): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const requested =
    new URL(req.url).searchParams.get('impersonate') ||
    (typeof bodyImpersonate === 'string' ? bodyImpersonate : null);
  const acting = await resolveActingUser(req, requested);
  if (!acting.ok) return { ok: false, response: acting.response };
  return { ok: true, userId: acting.userId };
}

/** GET /api/agent/v2/sessions — the sidebar's session tree. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const acting = await actingUserIdFor(req);
  if (!acting.ok) return acting.response;
  const actingUserId = acting.userId;

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace') || undefined;

  const available = await isAvailable(supabase);
  if (!available) {
    // Migration not applied yet: report empty rather than erroring the UI.
    return NextResponse.json({ available: false, sessions: [], workspaces: [] });
  }

  const [sessions, workspaces, ceoSessionId] = await Promise.all([
    listSessions(supabase, actingUserId, { workspaceId }),
    listWorkspaces(supabase, actingUserId),
    // The permanent CEO conversation: created on first look and kept out of the
    // ordinary list, so it can be pinned above the day's threads and never deleted.
    ensureCeoSession(supabase, actingUserId),
  ]);

  const visible = sessions.filter((s) => s.workspaceId !== 'ceo');

  /**
   * Two per-session signals the sidebar dots need.
   *
   * A pending approval means the agent has STOPPED and is waiting for the owner, which is
   * the one state worth interrupting for. A terminal run that ended in `completed` or
   * `cancelled` means "there is something new in there" — the client decides whether the
   * owner has actually looked at it.
   *
   * Both are deliberately fetched as two flat queries rather than per-tile lookups: a
   * sidebar of 20 threads must not become 40 round trips. The approvals query selects
   * ONLY the session id alias, because a real approval payload carries whole landing-page
   * sections and would pull megabytes across the wire for a coloured dot.
   */
  const [approvalsRes, runsRes] = await Promise.all([
    supabase
      .from('agent_events')
      .select('sess:payload->>sessionId')
      .eq('user_id', actingUserId)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('status', 'pending'),
    supabase
      .from('harness_runs')
      .select('session_id, status, finished_at, created_at')
      .eq('user_id', actingUserId)
      .order('created_at', { ascending: false })
      .limit(300),
  ]);

  const approvalCounts = new Map<string, number>();
  for (const row of (approvalsRes as any)?.data ?? []) {
    const id = (row as any)?.sess;
    // Approvals recorded before the session was stamped on them have no id here; they
    // simply do not light a tile. They expire within 24h anyway.
    if (typeof id === 'string' && id) approvalCounts.set(id, (approvalCounts.get(id) ?? 0) + 1);
  }

  const lastRunBySession = new Map<string, { status: string; finishedAt: string | null }>();
  for (const row of (runsRes as any)?.data ?? []) {
    const id = (row as any)?.session_id;
    // Rows arrive newest-first, so the first one seen for a session is its latest run.
    if (typeof id === 'string' && !lastRunBySession.has(id)) {
      lastRunBySession.set(id, {
        status: String((row as any).status ?? ''),
        finishedAt: ((row as any).finished_at as string | null) ?? null,
      });
    }
  }

  return NextResponse.json({
    available: true,
    sessions: visible.map((s) => ({
      ...s,
      pendingApprovals: approvalCounts.get(s.id) ?? 0,
      lastRun: lastRunBySession.get(s.id) ?? null,
    })),
    workspaces,
    ceoSessionId,
  });
}

/** POST /api/agent/v2/sessions — create a session or a workspace. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await isAvailable(supabase))) {
    return NextResponse.json(
      {
        error:
          'Harness session store is not initialized. Apply supabase/migrations/20261010000000_harness_session_log.sql.',
      },
      { status: 503 }
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const acting = await actingUserIdFor(req, body?.impersonate);
  if (!acting.ok) return acting.response;
  const actingUserId = acting.userId;

  if (body.kind === 'workspace') {
    const ws = await createWorkspace(supabase, actingUserId, String(body.name || ''));
    if (!ws) return NextResponse.json({ error: 'Could not create workspace' }, { status: 400 });
    return NextResponse.json({ workspace: ws });
  }

  const session = await createSession(supabase, actingUserId, {
    title: typeof body.title === 'string' ? body.title : undefined,
    workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
  });

  if (!session) {
    return NextResponse.json({ error: 'Could not create session' }, { status: 500 });
  }
  return NextResponse.json({ session });
}
