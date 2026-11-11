import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isAvailable, appendEvents } from '@/lib/agent/harness/store';
import { createEvent } from '@/lib/agent/harness/events';
import { enqueueRun, runsAvailableCheck, getRun, toSummary, hasLiveRun } from '@/lib/agent/harness/runs';

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

  // An empty wallet must not start work we then fail to bill. Media tools were already
  // gated; text turns were not, which is an open tap rather than a wrong number.
  {
    const { canStartTurn } = await import('@/lib/agent/usage');
    const affordable = await canStartTurn(user.id);
    if (!affordable.ok) {
      return NextResponse.json(
        { error: 'insufficient_credits', message: affordable.reason },
        { status: 402 }
      );
    }
  }

  // ONE run per session at a time. The client queues while a turn is running, but a
  // reload, a second tab, another device or a direct call reaches this route with a
  // run already live, and two runs appending to the same event log interleave their
  // events. The client treats this 409 as "queue it", so a message is never lost.
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  const live = await hasLiveRun(supabase, sessionId);
  if (live) {
    // The task is still working. A message sent now is STEERING: it is written to the
    // event log and the running worker folds it into its next step, so the agent
    // answers it without the turn being restarted or a second run being started.
    if (!message) {
      return NextResponse.json(
        { error: 'run_in_progress', message: 'A run is already working on this chat.' },
        { status: 409 }
      );
    }
    await appendEvents(supabase, sessionId, [
      createEvent('user.message', {
        id: typeof body.messageId === 'string' ? body.messageId : `u_${Date.now()}`,
        text: message,
        ...(Array.isArray(body.attachments) ? { attachments: body.attachments } : {}),
      }),
    ]);
    return NextResponse.json({
      steered: true,
      sessionId,
      message: 'Delivered to the running task — it will pick this up on its next step.',
    });
  }

  if (message) {
    await appendEvents(supabase, sessionId, [
      createEvent('user.message', {
        id: typeof body.messageId === 'string' ? body.messageId : `u_${Date.now()}`,
        text: message,
        ...(Array.isArray(body.attachments) ? { attachments: body.attachments } : {}),
      }),
    ]);
  }

  // Name the chat on the durable path too. This is the DEFAULT path now, so
  // without this every conversation stayed "New session" forever - the title
  // logic only ever ran in the legacy streaming route.
  if (message) {
    void (async () => {
      try {
        const { maybeAutoTitle } = await import('@/lib/agent/harness/persist');
        await maybeAutoTitle(supabase, user.id, sessionId, message);
      } catch {
        /* naming never blocks a run */
      }
    })();
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

  // Kick the worker now instead of waiting for the next cron tick.
  //
  // Cron only fires once a minute, so a freshly queued run could sit idle for up
  // to 60s and feel broken. Fire-and-forget on purpose: the run is already
  // durable, so if this call is rejected the cron still picks it up.
  try {
    const base =
      (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '') ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : '');
    const secret = process.env.CRON_SECRET || '';
    if (base && secret) {
      void fetch(`${base}/api/cron/harness-runner?maxSteps=200`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(2_000),
      }).catch(() => {});
    }
  } catch {
    /* non-fatal: the cron sweeps the queue every minute */
  }

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
