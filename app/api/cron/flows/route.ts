import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runDueSteps } from '@/lib/flows/scheduling';
import { SCHEDULES, RUNS, quietHoursFor, scheduledStore } from '@/lib/flows/store';
import { dispatchApprovedDeliveries, expireStaleDeliveries, releaseStaleClaims } from '@/lib/flows/delivery';
import { queueDueStep } from '@/lib/flows/queue-step';

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
 *
 * THREE JOBS, AND THE ORDER MATTERS
 *   1. queue    — turn due steps into approvals, or apply the ones that touch only the CRM
 *   2. dispatch — send what a human approved, and nothing else
 *   3. tidy     — release crashed claims, expire approvals nobody answered
 * Step 2 did not exist for a while: steps were written to the queue and never sent, so a flow that
 * "ran" reached nobody. Step 3 did not exist either, so a crashed worker wedged rows for ever.
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
        // One due step, turned into work — a shared function, so a probe runs exactly what the
        // clock runs. It queues approvals and applies CRM-only steps; it never sends anything.
        await queueDueStep(supabase, { userId, step });
      },
    });

    results.push({ userId, ...report });
  }

  // Whatever a human has already approved goes out now, and stale rows stop pretending to be
  // pending. Both are best-effort: a failure here must not turn the scheduler tick into an error.
  const released = await releaseStaleClaims(supabase).catch(() => 0);
  const dispatched = await dispatchApprovedDeliveries(supabase).catch(() => ({ considered: 0, outcomes: [] }));
  const expired = await expireStaleDeliveries(supabase).catch(() => 0);

  return NextResponse.json({
    ok: true,
    ranAt: now.toISOString(),
    owners: owners.length,
    results,
    dispatch: {
      considered: dispatched.considered,
      sent: dispatched.outcomes.filter((o) => o.status === 'delivered').length,
      blocked: dispatched.outcomes.filter((o) => o.status === 'blocked').length,
      failed: dispatched.outcomes.filter((o) => o.status === 'failed').length,
      releasedClaims: released,
      expiredApprovals: expired,
    },
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
  // The delivery queue is the half of the story that used to be invisible: steps queued for a human,
  // steps a human approved, and steps that actually reached a provider.
  const awaitingApproval = await supabase
    .from('agent_pending_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_approval');
  const approvedNotSent = await supabase
    .from('agent_pending_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'approved');
  const delivered = await supabase
    .from('agent_pending_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'delivered');
  return NextResponse.json({
    ok: tablesReady,
    pending: pending.count ?? 0,
    done: done.count ?? 0,
    runs: runs.count ?? 0,
    deliveryQueue: {
      awaitingApproval: awaitingApproval.count ?? 0,
      approvedNotSent: approvedNotSent.count ?? 0,
      delivered: delivered.count ?? 0,
    },
    note: tablesReady ? undefined : `scheduler tables missing: ${probe.error?.message} — apply supabase/migrations/20261112000000_flow_scheduling.sql`,
  });
}
