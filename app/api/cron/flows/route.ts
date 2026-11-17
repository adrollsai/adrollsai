import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runDueSteps } from '@/lib/flows/scheduling';
import { SCHEDULES, RUNS, quietHoursFor, scheduledStore } from '@/lib/flows/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The clock.
 *
 * Every minute this looks for steps that are due and runs them through the five gates in
 * scheduling.ts — kill switch, opt-out, quiet hours, cross-flow freshness, idempotency. A step that
 * passes is handed to the delivery queue rather than blasted out inline, so a human still sees it
 * before a customer does.
 *
 * Protected by CRON_SECRET. Without it, anyone could force the scheduler to run.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization') ?? '';
    const header = request.headers.get('x-cron-secret') ?? '';
    const query = new URL(request.url).searchParams.get('secret') ?? '';
    const ok = auth === `Bearer ${secret}` || header === secret || query === secret;
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const now = new Date();

  // Who has work due right now? One tick per owner, so each gets their own quiet hours and switch.
  const { data: due, error } = await supabase
    .from(SCHEDULES)
    .select('user_id')
    .eq('status', 'pending')
    .lte('run_at', now.toISOString())
    .limit(500);
  if (error) {
    // Before the migration is applied this is the normal path; say so instead of crashing.
    return NextResponse.json({ ok: true, note: 'scheduler tables not present yet', considered: 0 });
  }

  const owners = Array.from(new Set((due ?? []).map((r: any) => String(r.user_id))));
  const results: Record<string, unknown>[] = [];

  for (const userId of owners) {
    const store = scheduledStore(supabase, userId);
    const quietHours = await quietHoursFor(supabase, userId);

    const report = await runDueSteps(store, now, {
      quietHours,
      limit: 25,
      execute: async (step) => {
        // Hand the work to the delivery queue. The step is only marked done afterwards, so a crash
        // here leaves it retryable rather than silently dropped.
        const { error: qErr } = await supabase.from('agent_pending_deliveries').insert({
          user_id: userId,
          lead_id: step.leadId,
          channel: step.kind === 'call' ? 'call' : 'whatsapp',
          body: `Flow ${step.flowId} step ${step.stepIndex} due at ${step.runAt}`,
          status: 'pending',
        });
        if (qErr) {
          // No queue table or no row shape for this channel yet: fail loudly so the scheduler
          // reports it instead of pretending the message went out.
          throw new Error(`could not queue step ${step.id}: ${qErr.message}`);
        }
      },
    });

    results.push({ userId, ...report });
  }

  return NextResponse.json({
    ok: true,
    ranAt: now.toISOString(),
    owners: owners.length,
    results,
  });
}

/** A tiny read-only health view: how much is owed, and how much has run. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret') ?? '';
    if (header !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  // A count-only query does not reliably error on a missing table, which made this endpoint report
  // ok:true for tables that were never created. A real select is the honest probe.
  const probe = await supabase.from(SCHEDULES).select('id').limit(1);
  const tablesReady = !probe.error;
  const pending = await supabase.from(SCHEDULES).select('id', { count: 'exact', head: true }).eq('status', 'pending');
  const done = await supabase.from(SCHEDULES).select('id', { count: 'exact', head: true }).eq('status', 'done');
  const runs = await supabase.from(RUNS).select('id', { count: 'exact', head: true });
  return NextResponse.json({
    ok: tablesReady,
    pending: pending.count ?? 0,
    done: done.count ?? 0,
    runs: runs.count ?? 0,
    note: tablesReady ? undefined : `scheduler tables missing: ${probe.error?.message} — apply supabase/migrations/20260512_flow_scheduling.sql`,
  });
}
