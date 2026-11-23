import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { listIncidents, sortIncidents } from '@/lib/ops/incidents';
import type { IncidentStatus } from '@/lib/ops/types';

/**
 * GET /api/ops/incidents — what the watchdog has found, whether it fixed it, and what is
 * waiting on the owner.
 *
 * Auth: a `super_admin` profile, exactly like /api/admin/ledger. An incident row names a
 * tenant and describes a fault in the platform, so tenants cannot list the board.
 *
 * WHY THIS ROUTE CANNOT FIX ANYTHING
 * There is no "approve and apply" here, and the absence is the design. The repairs that are
 * safe already ran — that is what makes them safe. Everything on this board with
 * `status: 'needs_approval'` is a problem whose correct fix needs a human who understands it:
 * a campaign budget, a customer message, a pricing decision, a code change. A button that
 * claims to apply those would be lying about what a serverless cron can do, and the repo
 * already has a review gate (lib/agent/review-gate.ts) for the things an agent may execute on
 * approval. So the owner's actions here are bookkeeping only: acknowledge, dismiss, or close
 * something they fixed themselves.
 *
 * Query parameters:
 *   ?status=open|needs_approval|repaired|resolved|ignored|all   (default: everything live)
 *   ?limit=<1..500>                                             (default 100)
 *   ?format=text                                                (a digest to read, not JSON)
 */

const supabaseAdmin =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

/** Statuses that mean "still true right now". */
const LIVE: IncidentStatus[] = ['open', 'needs_approval', 'repaired'];

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profileError || profile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server is not configured to read the incident board' }, { status: 503 });
    }

    const url = new URL(request.url);
    const requestedStatus = url.searchParams.get('status');
    const limit = Number(url.searchParams.get('limit') ?? '');
    const format = url.searchParams.get('format');

    // Default is the live board, not the archive: an owner opening this wants to know what is
    // true now, and `?status=all` is there when they are reviewing a fix.
    const status: IncidentStatus | 'all' =
      requestedStatus === 'all'
        ? 'all'
        : (LIVE as string[]).includes(requestedStatus || '')
          ? (requestedStatus as IncidentStatus)
          : 'all';

    const all = await listIncidents(supabaseAdmin, {
      status,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
    });
    const incidents = sortIncidents(all);

    // The default view asks only for live incidents: read everything, then filter, because
    // listIncidents takes one status and the owner's board is the union of three.
    const shown =
      status === 'all' && !requestedStatus
        ? incidents.filter((incident) => LIVE.includes(incident.status))
        : incidents;

    if (format === 'text') {
      return new NextResponse(renderDigest(shown), {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json({
      count: shown.length,
      summary: summarise(shown),
      incidents: shown.map((incident) => ({
        id: incident.id,
        class: incident.class,
        severity: incident.severity,
        status: incident.status,
        title: incident.title,
        evidence: incident.evidence,
        suggestedFix: incident.suggested_fix,
        blastRadius: incident.blast_radius,
        subject: { table: incident.subject_table, id: incident.subject_id },
        userId: incident.user_id,
        occurrences: incident.occurrences,
        repairAttempts: incident.repair_attempts,
        repairLog: incident.repair_log,
        firstSeenAt: incident.first_seen_at,
        lastSeenAt: incident.last_seen_at,
        lastRepairedAt: incident.last_repaired_at,
        resolvedAt: incident.resolved_at,
        detail: incident.detail,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ops-incidents] read failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/ops/incidents — the owner's bookkeeping, and nothing more.
 *
 * Body: `{ id, action: 'ignore' | 'resolve' | 'reopen' }`
 *
 * `resolve` is how a human says "I fixed this myself" and clears it off the board without
 * waiting for the condition to age out. `ignore` mutes something known and accepted (a warning
 * that will never be fixed); the sweep leaves ignored incidents alone rather than nagging.
 * `reopen` undoes either.
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!supabaseAdmin) return NextResponse.json({ error: 'Server is not configured' }, { status: 503 });

    const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string };
    const id = String(body.id || '').trim();
    const action = String(body.action || '').trim();

    if (!id) return NextResponse.json({ error: 'An incident id is required' }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (action === 'ignore') patch.status = 'ignored';
    else if (action === 'resolve') {
      patch.status = 'resolved';
      patch.resolved_at = new Date().toISOString();
    } else if (action === 'reopen') {
      patch.status = 'open';
      patch.resolved_at = null;
    } else {
      return NextResponse.json(
        { error: "action must be one of 'ignore', 'resolve' or 'reopen'" },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('ops_incidents')
      .update(patch)
      .eq('id', id)
      .select('id, status')
      .single();
    if (error) return NextResponse.json({ error: String(error.message || error) }, { status: 500 });

    return NextResponse.json({ ok: true, incident: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Counts, worst-first, for a header line. */
function summarise(incidents: Awaited<ReturnType<typeof listIncidents>>) {
  return {
    critical: incidents.filter((incident) => incident.severity === 'critical').length,
    warning: incidents.filter((incident) => incident.severity === 'warning').length,
    info: incidents.filter((incident) => incident.severity === 'info').length,
    needsApproval: incidents.filter((incident) => incident.status === 'needs_approval').length,
    repaired: incidents.filter((incident) => incident.status === 'repaired').length,
  };
}

/** Plain text, because "what is wrong" should be readable from a terminal. */
function renderDigest(incidents: Awaited<ReturnType<typeof listIncidents>>): string {
  if (!incidents.length) return 'Nothing is wrong. The watchdog has no open incidents.\n';

  const counts = summarise(incidents);
  const lines = [
    `${incidents.length} incident(s): ${counts.critical} critical, ${counts.warning} warning.`,
    `${counts.needsApproval} need your approval, ${counts.repaired} were repaired automatically.`,
    '',
  ];

  for (const incident of incidents) {
    lines.push(`[${incident.severity.toUpperCase()}] ${incident.title}`);
    lines.push(`  status: ${incident.status}${incident.repair_attempts ? ` (${incident.repair_attempts} repair attempt(s))` : ''}`);
    lines.push(`  evidence: ${incident.evidence}`);
    if (incident.suggested_fix) lines.push(`  we suggest: ${incident.suggested_fix}`);
    lines.push(`  first seen ${incident.first_seen_at}, last seen ${incident.last_seen_at}`);
    if (Array.isArray(incident.repair_log) && incident.repair_log.length) {
      const last = incident.repair_log[incident.repair_log.length - 1];
      lines.push(`  last repair: ${last.outcome} — ${last.detail}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
