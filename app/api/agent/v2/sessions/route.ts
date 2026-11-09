import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
  isAvailable,
  listSessions,
  createSession,
  listWorkspaces,
  createWorkspace,
} from '@/lib/agent/harness/store';

export const maxDuration = 30;

/** GET /api/agent/v2/sessions — the sidebar's session tree. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace') || undefined;

  const available = await isAvailable(supabase);
  if (!available) {
    // Migration not applied yet: report empty rather than erroring the UI.
    return NextResponse.json({ available: false, sessions: [], workspaces: [] });
  }

  const [sessions, workspaces] = await Promise.all([
    listSessions(supabase, user.id, { workspaceId }),
    listWorkspaces(supabase, user.id),
  ]);

  return NextResponse.json({ available: true, sessions, workspaces });
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

  if (body.kind === 'workspace') {
    const ws = await createWorkspace(supabase, user.id, String(body.name || ''));
    if (!ws) return NextResponse.json({ error: 'Could not create workspace' }, { status: 400 });
    return NextResponse.json({ workspace: ws });
  }

  const session = await createSession(supabase, user.id, {
    title: typeof body.title === 'string' ? body.title : undefined,
    workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
  });

  if (!session) {
    return NextResponse.json({ error: 'Could not create session' }, { status: 500 });
  }
  return NextResponse.json({ session });
}
