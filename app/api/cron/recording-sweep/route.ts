/**
 * Late-arriving recording collection.
 *
 * WHY THIS EXISTS
 * The status callback gives the carrier 3 s + 5 s + 5 s — 13 seconds — to publish a recording, then
 * gives up permanently. A recording that appears at 30 s is lost even though the carrier still has
 * it, and nothing ever goes back for it. That is why most AI calls end up with no audio at all.
 *
 * This sweep re-tries, using the call uuid now persisted into `leads.custom_fields` by the status
 * callback. It is capped per run, capped per call, and only ever looks at calls from the last two
 * days, so it cannot become a runaway job or resurrect ancient rows.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchVobizCallRecording } from '@/utils/vobiz-helper';
import { storeRecording } from '@/lib/automation/recording-store';
import { attachRecordingToCallLog } from '@/lib/automation/call-log-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** How many calls one invocation attempts. Functions are bounded by maxDuration anyway. */
const MAX_PER_RUN = 8;
/** Stop sweeping a call after this many tries. */
const MAX_SWEEPS = 8;
/** Only look back this far. */
const WINDOW_HOURS = 48;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

function authorized(request: Request): boolean {
  const expected = (process.env.CRON_SECRET || '').trim();
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.replace(/^Bearer\s+/i, '').trim() || new URL(request.url).searchParams.get('cronSecret') || '';
  return provided === expected;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return run();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return run();
}

async function run() {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();
  const results: Record<string, unknown>[] = [];

  // Candidates: a completed call, a stored uuid, still no recording.
  const { data: rows, error } = await supabaseAdmin
    .from('leads')
    .select('id, user_id, name, phone, voice_recording_url, voice_call_status, last_call_at, custom_fields')
    .eq('voice_call_status', 'completed')
    .is('voice_recording_url', null)
    .not('custom_fields->>vobiz_call_uuid', 'is', null)
    .gte('last_call_at', since)
    .limit(MAX_PER_RUN * 3);

  if (error) {
    console.error('[recording-sweep] candidate query failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let attempted = 0;
  for (const lead of rows ?? []) {
    if (attempted >= MAX_PER_RUN) break;

    const rawCf = (lead as any).custom_fields;
    let cf: any = {};
    try {
      cf = typeof rawCf === 'string' ? JSON.parse(rawCf || '{}') : (rawCf || {});
    } catch {
      cf = {};
    }

    const callUuid = String(cf.vobiz_call_uuid || '').trim();
    const sweeps = Number(cf.vobiz_recording_sweeps || 0);
    if (!callUuid || !Number.isFinite(sweeps) || sweeps >= MAX_SWEEPS) continue;

    attempted += 1;
    const trail = { leadId: lead.id, callUuid, attempt: sweeps + 1 };

    try {
      // Per-account credentials first: a sub-account's recording is not visible to the master.
      let authId = (process.env.VOBIZ_AUTH_ID || '').trim() || undefined;
      let authToken = (process.env.VOBIZ_AUTH_TOKEN || '').trim() || undefined;
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('business_info')
        .eq('id', (lead as any).user_id)
        .maybeSingle();
      const bi =
        typeof (prof as any)?.business_info === 'string'
          ? (() => {
              try {
                return JSON.parse((prof as any).business_info);
              } catch {
                return {};
              }
            })()
          : ((prof as any)?.business_info || {});
      if (bi?.voice_vobiz_auth_id) authId = bi.voice_vobiz_auth_id;
      if (bi?.voice_vobiz_auth_token) authToken = bi.voice_vobiz_auth_token;

      const carrierUrl = await fetchVobizCallRecording(callUuid, { authId, authToken });
      if (!carrierUrl) {
        await bumpSweepCount(lead.id, cf, sweeps + 1);
        results.push({ ...trail, outcome: 'not-ready' });
        continue;
      }

      const res = await fetch(carrierUrl, {
        headers: { 'X-Auth-ID': authId || '', 'X-Auth-Token': authToken || '' },
      });
      if (!res.ok) {
        await bumpSweepCount(lead.id, cf, sweeps + 1);
        results.push({ ...trail, outcome: `download ${res.status}` });
        continue;
      }

      const body = Buffer.from(await res.arrayBuffer());
      const stored = await storeRecording({
        leadId: lead.id,
        filename: `sweep_${Date.now()}.mp3`,
        body,
        contentType: res.headers.get('content-type') || 'audio/mpeg',
      });
      if (!stored) {
        await bumpSweepCount(lead.id, cf, sweeps + 1);
        results.push({ ...trail, outcome: 'archive-failed' });
        continue;
      }

      await supabaseAdmin
        .from('leads')
        .update({ voice_recording_url: stored.key })
        .eq('id', lead.id);

      const callLog = await attachRecordingToCallLog(supabaseAdmin, {
        leadId: lead.id,
        userId: (lead as any).user_id,
        recording: stored.key,
        phoneNumber: (lead as any).phone,
        startedAtIso: (lead as any).last_call_at,
        summary: 'Recovered by recording-sweep',
      });

      results.push({ ...trail, outcome: 'recovered', callLog: callLog.action });
      console.log(`[recording-sweep] recovered recording for lead ${lead.id} -> ${stored.key}`);
    } catch (err: any) {
      await bumpSweepCount(lead.id, cf, sweeps + 1);
      results.push({ ...trail, outcome: `error: ${err?.message}` });
    }
  }

  return NextResponse.json({ ok: true, candidates: rows?.length ?? 0, attempted, results });
}

/** Count the attempt so a permanently-missing recording stops being retried. */
async function bumpSweepCount(leadId: string, cf: any, next: number) {
  try {
    await supabaseAdmin
      .from('leads')
      .update({ custom_fields: { ...(cf || {}), vobiz_recording_sweeps: next } })
      .eq('id', leadId);
  } catch {
    /* best effort */
  }
}
