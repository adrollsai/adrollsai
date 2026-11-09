import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getRun, requestCancel, toSummary, reviveRun } from '@/lib/agent/harness/runs';
import { isAvailable, appendEvents } from '@/lib/agent/harness/store';
import { createEvent } from '@/lib/agent/harness/events';

export const maxDuration = 30;

/** GET /api/agent/v2/runs/[id] — status of one run. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const run = await getRun(supabase, id, user.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  return NextResponse.json({ run: toSummary(run) });
}

/**
 * PATCH /api/agent/v2/runs/[id] — revive a dead-lettered or failed run.
 *
 * Retries are automatic, but a dead-lettered run is deliberately NOT retried by
 * the worker: it either exhausted its attempts or a side effect may have
 * half-executed. Reviving is an explicit human decision after review.
 */
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ownership check before touching the row.
  const existing = await getRun(supabase, id, user.id);
  if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  if (existing.status !== 'dead' && existing.status !== 'failed') {
    return NextResponse.json(
      { error: `Only dead-lettered or failed runs can be revived (this one is ${existing.status}).` },
      { status: 409 }
    );
  }

  const revived = await reviveRun(supabase, id);
  if (!revived) return NextResponse.json({ error: 'Could not revive the run' }, { status: 500 });

  if (await isAvailable(supabase)) {
    await appendEvents(supabase, revived.session_id, [
      createEvent('run.status', { status: 'queued', detail: 'Requeued for another attempt.' }),
    ]);
  }

  return NextResponse.json({ run: toSummary(revived) });
}

/**
 * DELETE /api/agent/v2/runs/[id] — request cancellation.
 *
 * Cooperative: the worker checks this between model steps, so a cancelled run
 * stops at the next boundary rather than mid-generation.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await requestCancel(supabase, id, user.id);
  if (!ok) return NextResponse.json({ error: 'Could not cancel the run' }, { status: 400 });

  const run = await getRun(supabase, id, user.id);
  if (run && (await isAvailable(supabase))) {
    await appendEvents(supabase, run.session_id, [
      createEvent('run.status', { status: 'paused', detail: 'Cancellation requested.' }),
    ]);
  }

  return NextResponse.json({ ok: true, run: run ? toSummary(run) : null });
}
