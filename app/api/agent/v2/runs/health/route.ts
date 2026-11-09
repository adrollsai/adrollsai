import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { queueStats, runsAvailableCheck } from '@/lib/agent/harness/runs';
import { cronAuthGuard } from '@/lib/agent/harness/cron-auth';

export const maxDuration = 30;

/**
 * GET /api/agent/v2/runs/health — operator view of the durable-run queue.
 *
 * Cron-secret protected because it reports across all tenants. Use it as a
 * liveness/backlog probe:
 *   queued creeping up + oldest_queued_age_seconds growing  → worker not keeping up
 *   expired_leases > 0                                       → workers dying mid-slice
 *   dead climbing                                            → something is failing repeatedly
 */
export async function GET(req: Request) {
  const denied = cronAuthGuard(req);
  if (denied) return denied;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  if (!(await runsAvailableCheck(admin))) {
    return NextResponse.json({ error: 'harness_runs is not initialized' }, { status: 503 });
  }

  const stats = await queueStats(admin);
  if (!stats) return NextResponse.json({ error: 'stats unavailable' }, { status: 500 });

  // A cheap health verdict so an uptime monitor does not need to know the shape.
  const backlog = stats.queued + stats.overdue_retries;
  const healthy =
    stats.expired_leases === 0 && (backlog === 0 || stats.oldest_queued_age_seconds < 300);

  return NextResponse.json({
    healthy,
    stats,
    hints: {
      backlog,
      note: healthy
        ? 'No expired leases and no backlog older than 5 minutes.'
        : 'Backlog older than 5 minutes or expired leases present — check the worker is running.',
    },
  });
}
