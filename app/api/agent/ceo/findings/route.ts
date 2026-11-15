import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createUserClient } from '@/utils/supabase/server';
import { analyseDay, renderReport, summariseFindings } from '@/lib/agent/ceo-findings';
import { gatherDayMetrics, supabaseMetricsReader, windowFor } from '@/lib/agent/ceo-metrics';

export const maxDuration = 120;

/**
 * GET /api/agent/ceo/findings
 *
 * Yesterday's findings for the CEO surface, and — with the cron secret — the daily job that
 * computes them for every business and files the report.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It takes no action. It reads numbers, ranks findings, and writes a report. Anything the
 * report suggests that would spend money or message a customer stays a suggestion and goes
 * through the review gate like every other dangerous action. A daily job that acts on its own
 * analysis is the thing the owner specifically ruled out.
 *
 * TWO CALLERS, ONE ENGINE
 *   ?owner=1          the signed-in owner, on demand (the CEO tab)
 *   ?all=1&secret=…   the cron: every business with a routine, filed for later reading
 */
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function findingsFor(
  supabase: any,
  userId: string,
  timezone: string,
  dayOffset = 0,
) {
  const now = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
  const window = windowFor(now, timezone);
  const { metrics, missing } = await gatherDayMetrics(supabaseMetricsReader(supabase, userId), window);
  const findings = analyseDay(metrics);
  return {
    window: metrics.window,
    findings,
    summary: summariseFindings(findings),
    report: renderReport(metrics, findings),
    metrics,
    missing,
  };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') || req.nextUrl.searchParams.get('secret');
  const wantsAll = req.nextUrl.searchParams.get('all') === '1';

  if (wantsAll) {
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const supabase = adminClient();
    const { data: routines, error } = await supabase
      .from('business_routines')
      .select('user_id, timezone, enabled')
      .eq('enabled', true)
      .limit(2000);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const filed: string[] = [];
    const skipped: string[] = [];
    for (const routine of routines ?? []) {
      try {
        const result = await findingsFor(supabase, routine.user_id, routine.timezone || 'Asia/Kolkata');
        if (!result.findings.length) {
          skipped.push(`${routine.user_id}: nothing to report`);
          continue;
        }
        // Filed where the owner will read it, as an ordinary agent event so it shows in the
        // same stream as everything else the agent did.
        const { error: insertError } = await supabase.from('agent_events').insert({
          user_id: routine.user_id,
          event_type: 'CEO_DAILY_FINDINGS',
          status: 'complete',
          scheduled_for: new Date().toISOString(),
          payload: {
            window: result.window,
            summary: result.summary,
            report: result.report,
            findings: result.findings,
            missing: result.missing,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (insertError) skipped.push(`${routine.user_id}: ${insertError.message}`);
        else filed.push(routine.user_id);
      } catch (error: any) {
        skipped.push(`${routine.user_id}: ${String(error?.message ?? error)}`);
      }
    }
    return NextResponse.json({ ok: true, filed: filed.length, skipped: skipped.length, detail: skipped.slice(0, 10) });
  }

  // On demand, for the signed-in owner.
  try {
    const supabase = await createUserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('timezone')
      .eq('id', user.id)
      .maybeSingle();

    const admin = adminClient();
    const result = await findingsFor(admin, user.id, (profile as any)?.timezone || 'Asia/Kolkata');
    return NextResponse.json({ ok: true, readOnly: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message ?? error) }, { status: 500 });
  }
}
