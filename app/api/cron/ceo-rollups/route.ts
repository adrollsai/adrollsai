/**
 * Nightly CEO rollup: one small row per tenant per day.
 *
 * Runs after the EOD digest (see vercel.json) so it summarises a day that has actually finished.
 * Idempotent by construction — the primary key is (user_id, day), so a retry or a double invocation
 * updates the same row instead of appending a second one.
 *
 * It counts, it does not copy: agent_events and routine_runs can be millions of rows across tenants,
 * and the whole reason this table exists is to stop the CEO tab depending on their size.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildDayRollup, rollupDay } from '@/lib/automation/ceo-rollup';
import { reconcileRoutineRuns } from '@/lib/agent/routines';

export const maxDuration = 300;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const now = new Date();
  // The period that just ended, in the tenant's own timezone. One day back so the rollup summarises a
  // complete day rather than the one still in progress.
  const day = rollupDay(new Date(now.getTime() - 86_400_000));

  /**
   * Settle stuck routine rows BEFORE counting them.
   *
   * `payload.routineRuns` counts `routine_runs` rows, and those rows used to stay `queued` for ever
   * because nothing wrote the harness run's outcome back (measured 2026-11-26: 79 of 80 rows over
   * seven days, which is why this figure read 0 for every account). Counting first would bake the
   * stale status into the nightly number. Best-effort: a failed sweep must not cost the night's
   * rollup, so the counts are still written from whatever the table says.
   */
  const reconciled = await reconcileRoutineRuns(supabaseAdmin).catch((e: any) => {
    console.error('[ceo-rollups] routine reconcile failed:', e?.message || e);
    return null;
  });

  try {
    const { data: profiles, error } = await supabaseAdmin
      .from('profiles')
      .select('id, timezone')
      .limit(500);
    if (error) throw new Error(error.message);

    let written = 0;
    let skipped = 0;

    for (const profile of profiles ?? []) {
      const userId = String((profile as any).id);
      // Per-tenant day: a tenant in a different timezone has a different "yesterday".
      const tenantDay = rollupDay(new Date(now.getTime() - 86_400_000), (profile as any).timezone || 'Asia/Kolkata');

      const from = `${tenantDay}T00:00:00.000Z`;
      const to = `${tenantDay}T23:59:59.999Z`;

      const [events, runs, failed, artifactsRes] = await Promise.all([
        supabaseAdmin.from('agent_events').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).gte('created_at', from).lte('created_at', to),
        supabaseAdmin.from('routine_runs').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).gte('created_at', from).lte('created_at', to),
        supabaseAdmin.from('routine_runs').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('status', 'failed').gte('created_at', from).lte('created_at', to),
        supabaseAdmin.from('credit_transactions').select('amount')
          .eq('user_id', userId).lt('amount', 0).gte('created_at', from).lte('created_at', to),
      ]);

      // A tenant with no activity at all does not get a row: an empty day is the absence of a record,
      // and writing 500 empty rows a night would defeat the point of a bounded table.
      const eventCount = events.count ?? 0;
      const runCount = runs.count ?? 0;
      if (eventCount === 0 && runCount === 0) {
        skipped++;
        continue;
      }

      const creditsSpent = (artifactsRes.data ?? []).reduce(
        (sum: number, row: any) => sum + Math.abs(Number(row.amount || 0)),
        0,
      );

      const payload = buildDayRollup(tenantDay, {
        agentEvents: eventCount,
        routineRuns: runCount,
        failedRuns: failed.count ?? 0,
        artifacts: 0, // artefacts are counted from the events themselves when they carry a type
        creditsSpent,
      });

      const { error: upsertErr } = await supabaseAdmin
        .from('ceo_daily_rollups')
        .upsert(
          {
            user_id: userId,
            day: tenantDay,
            payload,
            event_count: eventCount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,day' },
        );
      if (upsertErr) {
        console.warn(`[ceo-rollups] upsert failed for ${userId}: ${upsertErr.message}`);
        skipped++;
        continue;
      }
      written++;
    }

    return NextResponse.json({ success: true, day, written, skipped, reconciled });
  } catch (error: any) {
    console.error('[ceo-rollups] failed:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'rollup failed' }, { status: 500 });
  }
}
