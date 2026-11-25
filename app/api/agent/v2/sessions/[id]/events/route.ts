import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { appendEvent, loadEvents, loadSession } from '@/lib/agent/harness/store';
import { resolveActingUser } from '@/utils/route-auth';
import { harnessDataClient } from '@/lib/agent/harness/acting-db';
import { createEvent, HARNESS_EVENT_TYPES, type HarnessEventType } from '@/lib/agent/harness/events';

export const maxDuration = 30;

/**
 * GET /api/agent/v2/sessions/[id]/events?after=<seq>
 * Incremental tail of the log — lets the client resume a run it did not watch
 * instead of losing it when the tab was backgrounded.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  /**
   * Events are read by session id alone, and `loadEvents` does not filter by user — under RLS that
   * was safe, because the caller's client could only ever see their own sessions. Impersonation reads
   * with a service-role client, so the ownership proof has to happen HERE instead: the session must
   * belong to the account being acted for, or this would be a cross-tenant read.
   */
  const acting = await resolveActingUser(req, new URL(req.url).searchParams.get('impersonate'));
  if (!acting.ok) return acting.response;

  const data = await harnessDataClient(supabase, user.id, acting.userId);
  const owned = await loadSession(data, acting.userId, id);
  if (!owned) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const after = Number(new URL(req.url).searchParams.get('after') || 0) || 0;
  const events = await loadEvents(data, id, after);
  return NextResponse.json({ events });
}

/**
 * POST /api/agent/v2/sessions/[id]/events
 * Appends client-originated events (currently `user.message`). Validated
 * against the event schema before it can enter the log.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.type !== 'string') {
    return NextResponse.json({ error: 'type is required' }, { status: 400 });
  }
  if (!HARNESS_EVENT_TYPES.includes(body.type as HarnessEventType)) {
    return NextResponse.json({ error: `Unknown event type: ${body.type}` }, { status: 400 });
  }

  let event: { type: HarnessEventType; data: Record<string, unknown> };
  try {
    event = createEvent(body.type as HarnessEventType, body.data ?? {}) as {
      type: HarnessEventType;
      data: Record<string, unknown>;
    };
  } catch (err: any) {
    return NextResponse.json(
      { error: `Invalid payload for ${body.type}: ${err?.message || 'schema mismatch'}` },
      { status: 400 }
    );
  }

  const acting = await resolveActingUser(req, body.impersonate);
  if (!acting.ok) return acting.response;
  const data = await harnessDataClient(supabase, user.id, acting.userId);
  const owned = await loadSession(data, acting.userId, id);
  if (!owned) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const ok = await appendEvent(data, id, event.type, event.data);
  if (!ok) return NextResponse.json({ error: 'Could not append event' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
