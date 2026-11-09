import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { loadSession, renameSession, deleteSession, setSessionStatus } from '@/lib/agent/harness/store';
import { hasLiveRun } from '@/lib/agent/harness/runs';

export const maxDuration = 30;

/** GET /api/agent/v2/sessions/[id] — the session plus its projected state. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const loaded = await loadSession(supabase, user.id, id);
  if (!loaded) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Reconcile a status left at 'running' because the browser vanished mid-turn.
  // Without this the sidebar dot shows the session as busy forever.
  let status = loaded.session.status;
  if (status === 'running') {
    const live = await hasLiveRun(supabase, id);
    if (!live) {
      status = 'idle';
      await setSessionStatus(supabase, id, 'idle');
      if (loaded.state.status !== 'idle') {
        loaded.state = { ...loaded.state, status: 'idle' };
      }
    }
  }

  return NextResponse.json({
    session: {
      id: loaded.session.id,
      title: loaded.session.title,
      workspaceId: loaded.session.workspace_id,
      status,
      updatedAt: loaded.session.updated_at,
    },
    events: loaded.events,
    // The projection is computed on the server so the client renders the same
    // view on first paint as on any later replay.
    state: loaded.state,
  });
}

/** PATCH /api/agent/v2/sessions/[id] — rename. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title : '';
  if (!title.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const ok = await renameSession(supabase, user.id, id, title);
  if (!ok) return NextResponse.json({ error: 'Rename failed' }, { status: 400 });
  return NextResponse.json({ ok: true, title: title.trim() });
}

/** DELETE /api/agent/v2/sessions/[id] — removes the session and its log. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await deleteSession(supabase, user.id, id);
  if (!ok) return NextResponse.json({ error: 'Delete failed' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
