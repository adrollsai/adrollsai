import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isAvailable, appendEvents } from '@/lib/agent/harness/store';
import { createEvent } from '@/lib/agent/harness/events';
import { enqueueRun, runsAvailableCheck, getRun, toSummary } from '@/lib/agent/harness/runs';

export const maxDuration = 30;

/**
 * POST /api/agent/v2/runs
 *
 * Queues a durable background run for a session. Optional `message` is appended
 * to the event log first (the client is the only writer of `user.message`).
 * Returns immediately — the worker picks the run up on its next tick.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await isAvailable(supabase)) || !(await runsAvailableCheck(supabase))) {
    return NextResponse.json(
      { error: 'Durable runs are not initialized. Apply the harness migrations.' },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

  // Confirm the session belongs to this user before queueing work against it.
  const { data: session } = await supabase
    .from('harness_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message) {
    await appendEvents(supabase, sessionId, [
      createEvent('user.message', {
        id: typeof body.messageId === 'string' ? body.messageId : `u_${Date.now()}`,
        text: message,
        ...(Array.isArray(body.attachments) ? { attachments: body.attachments } : {}),
      }),
    ]);
  }

  const goal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : message;

  // A client-supplied key makes enqueue idempotent: an impatient double-click
  // or a retried request resolves to the same run instead of paying twice.
  const idempotencyKey =
    typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 120)
      : undefined;

  const run = await enqueueRun(supabase, {
    sessionId,
    userId: user.id,
    goal,
    idempotencyKey,
    priority: typeof body.priority === 'number' ? body.priority : 0,
  });
  if (!run) return NextResponse.json({ error: 'Could not queue the run' }, { status: 500 });

  await appendEvents(supabase, sessionId, [
    createEvent('run.status', { status: 'queued', detail: 'Queued for background execution.' }),
  ]);

  return NextResponse.json({ run: toSummary(run) }, { status: 202 });
}

/** GET /api/agent/v2/runs?sessionId=… — recent runs for a session. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessionId = new URL(req.url).searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

  const { data, error } = await (supabase as any)
    .from('harness_runs')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ runs: [] });
  return NextResponse.json({ runs: (data || []).map(toSummary) });
}
