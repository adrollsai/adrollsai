/**
 * Collect recordings the hangup callback could not.
 *
 * The callback gives the carrier 13 seconds to publish a recording, then gives up forever. This runs
 * every 10 minutes and goes back for them.
 *
 * HOW IT FINDS THEM, measured against the live carrier API rather than assumed:
 *   - the Recording list cannot be filtered by date (`from`/`to` are ignored) and caps at 20 per page,
 *     so this pages the newest 100 and matches each recording to a lead by the last ten digits of the
 *     dialled number;
 *   - a lead is only matched when it has NO recording, which makes the run idempotent — a recovered
 *     call simply stops being a candidate;
 *   - one download per matched lead, capped per invocation so it fits inside maxDuration.
 *
 * Credentials are resolved per account as well as globally: a tenant with its own Vobiz sub-account
 * has its recordings under that account, and the master listing cannot see them.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { storeRecording } from '@/lib/automation/recording-store';
import { attachRecordingToCallLog } from '@/lib/automation/call-log-sync';
import {
  listRecentRecordings,
  matchRecordingsToLeads,
  type CarrierRecording,
  type LeadForMatching,
} from '@/lib/automation/vobiz-recordings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Downloads per invocation. Each is a fetch + an upload, so this is the time budget. */
const MAX_RECOVERIES = 6;
/** Leads considered per run. */
const MAX_LEADS = 300;
/** Only calls this recent are worth chasing. */
const WINDOW_DAYS = 7;
/** Distinct credential sets to list with. */
const MAX_CREDENTIAL_SETS = 5;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

function authorized(request: Request): boolean {
  const expected = (process.env.CRON_SECRET || '').trim();
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const provided =
    header.replace(/^Bearer\s+/i, '').trim() || new URL(request.url).searchParams.get('cronSecret') || '';
  return provided === expected;
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

interface CredentialSet {
  authId: string;
  authToken: string;
  label: string;
}

async function credentialSets(userIds: string[]): Promise<CredentialSet[]> {
  const sets: CredentialSet[] = [];
  const seen = new Set<string>();

  const envId = (process.env.VOBIZ_AUTH_ID || '').trim();
  const envToken = (process.env.VOBIZ_AUTH_TOKEN || '').trim();
  if (envId && envToken) {
    sets.push({ authId: envId, authToken: envToken, label: 'env' });
    seen.add(envId);
  }

  if (userIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, business_info')
      .in('id', userIds.slice(0, 60));
    for (const p of profiles ?? []) {
      const raw = (p as any).business_info;
      let bi: any = {};
      try {
        bi = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
      } catch {
        bi = {};
      }
      const id = String(bi?.voice_vobiz_auth_id || '').trim();
      const token = String(bi?.voice_vobiz_auth_token || '').trim();
      if (!id || !token || seen.has(id)) continue;
      sets.push({ authId: id, authToken: token, label: `tenant:${p.id}` });
      seen.add(id);
      if (sets.length >= MAX_CREDENTIAL_SETS) break;
    }
  }

  return sets;
}

async function run() {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();

  // Candidates: a completed call with no recording. Small payload, no audio.
  const { data: leadRows, error } = await supabaseAdmin
    .from('leads')
    .select('id, user_id, name, phone, voice_call_status, voice_recording_url, last_call_at')
    .eq('voice_call_status', 'completed')
    .is('voice_recording_url', null)
    .not('phone', 'is', null)
    .gte('last_call_at', since)
    .limit(MAX_LEADS);

  if (error) {
    console.error('[recording-sweep] candidate query failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const leads: LeadForMatching[] = (leadRows ?? []).map((l: any) => ({
    id: l.id,
    phone: l.phone,
    lastCallAt: l.last_call_at,
  }));

  if (leads.length === 0) {
    return NextResponse.json({ ok: true, leads: 0, recordings: 0, recovered: 0, results: [] });
  }

  const userIds = [...new Set((leadRows ?? []).map((l: any) => l.user_id).filter(Boolean))] as string[];
  const sets = await credentialSets(userIds);

  // Union of the recordings visible to every credential set.
  const all: CarrierRecording[] = [];
  const seenCalls = new Set<string>();
  for (const set of sets) {
    const found = await listRecentRecordings({ authId: set.authId, authToken: set.authToken });
    for (const rec of found) {
      if (seenCalls.has(rec.callUuid)) continue;
      seenCalls.add(rec.callUuid);
      all.push(rec);
    }
  }

  const matches = matchRecordingsToLeads(all, leads);

  const results: Record<string, unknown>[] = [];
  let recovered = 0;

  for (const match of matches) {
    if (recovered >= MAX_RECOVERIES) break;
    const lead = (leadRows ?? []).find((l: any) => l.id === match.leadId) as any;
    if (!lead) continue;

    // Use the credentials the recording was listed with.
    const set = sets[0];

    try {
      const res = await fetch(match.recording.recordingUrl, {
        headers: { 'X-Auth-ID': set?.authId || '', 'X-Auth-Token': set?.authToken || '' },
      });
      if (!res.ok) {
        results.push({ leadId: lead.id, outcome: `download ${res.status}` });
        continue;
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length < 1024) {
        results.push({ leadId: lead.id, outcome: `too small (${body.length} bytes)` });
        continue;
      }

      const stored = await storeRecording({
        leadId: lead.id,
        filename: `sweep_${match.recording.callUuid}.mp3`,
        body,
        contentType: 'audio/mpeg',
      });
      if (!stored) {
        results.push({ leadId: lead.id, outcome: 'archive failed' });
        continue;
      }

      await supabaseAdmin.from('leads').update({ voice_recording_url: stored.key }).eq('id', lead.id);

      const callLog = await attachRecordingToCallLog(supabaseAdmin, {
        leadId: lead.id,
        userId: lead.user_id,
        recording: stored.key,
        phoneNumber: lead.phone,
        startedAtIso: match.recording.addTime ? new Date(match.recording.addTime).toISOString() : lead.last_call_at,
        durationSeconds: Math.round(match.recording.durationMs / 1000),
      });

      recovered += 1;
      results.push({ leadId: lead.id, outcome: 'recovered', callLog: callLog.action, key: stored.key });
      console.log(`[recording-sweep] recovered ${match.recording.callUuid} -> lead ${lead.id} (${stored.key})`);
    } catch (err: any) {
      results.push({ leadId: lead.id, outcome: `error: ${err?.message}` });
    }
  }

  return NextResponse.json({
    ok: true,
    leads: leads.length,
    credentialSets: sets.length,
    recordings: all.length,
    matched: matches.length,
    recovered,
    results,
  });
}
