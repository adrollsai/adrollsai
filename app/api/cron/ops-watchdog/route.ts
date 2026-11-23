import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cronAuthGuard } from '@/lib/agent/harness/cron-auth';
import { heal } from '@/lib/ops/healer';
import { listIncidents, sortIncidents } from '@/lib/ops/incidents';
import { DETECTORS } from '@/lib/ops/detectors';
import { REPAIRS } from '@/lib/ops/repairs';

/**
 * The ops watchdog: one sweep every 30 minutes.
 *
 * WHAT THIS IS FOR
 * The app had no error tracking of any kind — no Sentry, no incident table, nothing between a
 * customer hitting a bug and the owner hearing about it second-hand. Meanwhile the evidence of
 * every failure was already being written down and never read: `harness_runs.error` for a dead
 * agent run, `video_tasks.last_error` for an abandoned render, `credit_holds.state` for credits
 * held against nothing. This route reads them on a schedule, deduplicates what it finds into
 * incidents, fixes the subset that is provably safe to fix, and tells the owner about the rest.
 *
 * WHY 30 MINUTES
 * Fast enough that a stuck run or a dead cron is caught inside the same hour it breaks; slow
 * enough that a transient blip has usually cleared itself before anyone is told, so the alert
 * list stays something the owner reads. Anything time-critical at a finer resolution already
 * has its own dedicated cron (harness-runner at 1 minute, video-watchdog at 20).
 *
 * AUTHORISATION
 * `cronAuthGuard`, the repo's two-secret rotation-aware guard, so rotating CRON_SECRET does not
 * produce a window where every cron 401s. It fails closed with 503 when no secret is configured.
 *
 * RESPONSE
 * The sweep's structured result, so a human can `curl` this route and read exactly what the
 * system saw and did. Add `?dryRun=1` to detect and record without repairing or notifying —
 * the first thing anyone wants when they do not yet trust it.
 */

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
/** Eleven detectors, each at most one round trip per table they touch. */
export const maxDuration = 120;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  const denied = cronAuthGuard(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const dryRun = ['1', 'true', 'yes'].includes((url.searchParams.get('dryRun') || '').toLowerCase());

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Supabase service credentials are not configured; the watchdog cannot read production.' },
      { status: 503 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    if (dryRun) {
      // A dry run is genuinely read-only. Incidents are still detected and recorded, because
      // knowing what the detectors would have found is the point; `applyRepairs: false` stops
      // any write leaving the incident table, and `notify: false` stops the message.
      const result = await heal({
        supabase,
        notify: false,
        applyRepairs: false,
        detectors: DETECTORS,
      });
      return NextResponse.json({
        dryRun: true,
        note: 'Detected and recorded incidents. No repairs applied, no notifications sent.',
        result,
        wouldRepair: Object.keys(REPAIRS),
      });
    }

    const result = await heal({ supabase });

    // Also return the board, sorted the way the console shows it. A watchdog response that
    // only says "created: 3" makes the reader open a second tool to find out what those three
    // things were.
    const board = sortIncidents(
      await listIncidents(supabase, { status: 'all', limit: 50 }).catch(() => []),
    );

    return NextResponse.json({
      ok: true,
      result,
      board: board.map((incident) => ({
        class: incident.class,
        severity: incident.severity,
        status: incident.status,
        title: incident.title,
        evidence: incident.evidence,
        suggestedFix: incident.suggested_fix,
        occurrences: incident.occurrences,
        repairAttempts: incident.repair_attempts,
        lastSeenAt: incident.last_seen_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ops-watchdog] sweep failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
