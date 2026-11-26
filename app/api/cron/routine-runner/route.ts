import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { materialiseDueRoutines, reconcileRoutineRuns } from '@/lib/agent/routines';

export const maxDuration = 300;

/**
 * Turns due business routines into harness runs.
 *
 * Called by cron (hourly). Separate from the harness runner on purpose: this decides
 * *what work exists today*; the worker decides *when to execute it*. Keeping the two
 * apart means a slow day never delays the next day's planning.
 *
 * Idempotent by construction — the (routine_id, period_key) unique key means running
 * this ten times in an hour still produces at most one run per routine per day.
 *
 * It also settles yesterday's rows: `reconcileRoutineRuns` writes each finished (or dead)
 * harness run's outcome back onto its `routine_runs` row, which nothing used to do.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') || req.nextUrl.searchParams.get('secret');
  const expected = process.env.CRON_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  try {
    const result = await materialiseDueRoutines(supabase);
    console.log(
      `[routines] checked ${result.checked}, queued ${result.queued.length}, skipped ${result.skipped.length}`
    );

    /**
     * Then settle the rows earlier ticks left behind.
     *
     * The harness run ends in a different process and nothing wrote its outcome back, so every
     * routine row stayed `queued` for ever (measured 2026-11-26: 79 of 80 rows over seven days).
     * The repair runs here — after dispatch, never before it — so a row is only settled once its
     * run has actually finished. Best-effort like every other cron sweep: a failed sweep must not
     * cost the day's dispatch.
     */
    const reconciled = await reconcileRoutineRuns(supabase).catch((e: any) => {
      console.error('[routines] reconcile failed:', e?.message || e);
      return null;
    });
    if (reconciled) {
      console.log(
        `[routines] reconciled ${reconciled.completed} completed, ${reconciled.failed} failed, ` +
          `${reconciled.unchanged} left alone of ${reconciled.examined} examined`
      );
    }

    return NextResponse.json({ ok: true, ...result, reconciled });
  } catch (e: any) {
    console.error('[routines] materialise failed:', e?.message || e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
