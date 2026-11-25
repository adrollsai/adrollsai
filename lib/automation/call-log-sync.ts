/**
 * Keeping `call_logs` and `leads` in agreement about a recording.
 *
 * WHAT WAS BROKEN
 * Two callbacks wrote to two different tables and neither knew about the other:
 *
 *   - the Vobiz status callback archived the audio and set `leads.voice_recording_url`
 *     (Procolor: 14 leads have a recording, some from today) but NEVER created a `call_logs` row;
 *   - the generic status callback inserted `call_logs` with
 *     `recording_url: formData.get('RecordingUrl')`, which is absent at that moment, so it stored null.
 *
 * The result is exactly what the owner reports: the call-history list is empty, so there is nothing
 * to play, even though the audio is sitting in storage. Procolor has 1,531 leads, 14 recordings, and
 * ZERO `call_logs` rows pointing at any of them.
 *
 * WHAT THIS DOES
 * One function that makes the two agree: find the call log for this call, attach the recording to
 * it, and create the row if the carrier callback never made one.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AttachRecordingInput {
  leadId: string;
  userId: string;
  /** What goes in the column: an R2 key, or a legacy storage path. Never a pre-signed URL. */
  recording: string;
  phoneNumber?: string | null;
  /** When the call started, so a created row sorts correctly. */
  startedAtIso?: string | null;
  durationSeconds?: number | null;
  summary?: string | null;
  callType?: string | null;
}

export interface AttachRecordingResult {
  /** How the row was reconciled. */
  action: 'updated' | 'inserted' | 'skipped';
  callLogId?: string;
  reason?: string;
}

/** Two calls within this window are treated as the same call. */
export const SAME_CALL_WINDOW_MS = 10 * 60 * 1000;

/**
 * Attach a recording to the call log for a call, creating the row when it is missing.
 *
 * Deliberately forgiving: every branch either reconciles or reports, and none throws — a failed
 * bookkeeping step must never lose a recording that is already safely archived.
 */
export async function attachRecordingToCallLog(
  admin: SupabaseClient,
  input: AttachRecordingInput,
): Promise<AttachRecordingResult> {
  const recording = String(input.recording || '').trim();
  if (!recording) return { action: 'skipped', reason: 'no recording to attach' };
  if (!input.leadId || !input.userId) return { action: 'skipped', reason: 'no lead or user' };

  const startedAt = input.startedAtIso ? new Date(input.startedAtIso) : new Date();
  const windowStart = new Date(startedAt.getTime() - SAME_CALL_WINDOW_MS).toISOString();
  const windowEnd = new Date(startedAt.getTime() + SAME_CALL_WINDOW_MS).toISOString();

  // 1. the obvious row: same lead, same call window
  let existing: { id: string; recording_url?: string | null } | null = null;
  try {
    const { data } = await admin
      .from('call_logs')
      .select('id, recording_url, started_at')
      .eq('lead_id', input.leadId)
      .gte('started_at', windowStart)
      .lte('started_at', windowEnd)
      .order('started_at', { ascending: false })
      .limit(1);
    existing = (data?.[0] as any) ?? null;
  } catch (err) {
    return { action: 'skipped', reason: `could not read call_logs: ${(err as Error)?.message}` };
  }

  if (existing?.id) {
    try {
      const { error } = await admin
        .from('call_logs')
        .update({ recording_url: recording })
        .eq('id', existing.id);
      if (error) return { action: 'skipped', callLogId: existing.id, reason: error.message };
      return { action: 'updated', callLogId: existing.id };
    } catch (err) {
      return { action: 'skipped', callLogId: existing.id, reason: (err as Error)?.message };
    }
  }

  // 2. no row at all: the carrier callback never wrote one, which is why the history is empty
  try {
    const { data, error } = await admin
      .from('call_logs')
      .insert({
        user_id: input.userId,
        lead_id: input.leadId,
        phone_number: input.phoneNumber ?? null,
        call_type: input.callType || 'AI_OUTGOING',
        duration: Math.max(0, Math.round(Number(input.durationSeconds) || 0)),
        status: 'CONNECTED',
        recording_url: recording,
        notes: input.summary ? `AI Voice Call: ${String(input.summary).slice(0, 300)}` : 'AI Voice Call completed',
        started_at: startedAt.toISOString(),
      })
      .select('id')
      .maybeSingle();
    if (error) return { action: 'skipped', reason: error.message };
    return { action: 'inserted', callLogId: (data as any)?.id };
  } catch (err) {
    return { action: 'skipped', reason: (err as Error)?.message };
  }
}

/**
 * True when a stored recording value will 403/400 in a browser as-is.
 *
 * A `/object/public/` path into a PRIVATE bucket is the value this bug left behind: it looks public,
 * it is not, and every one of Procolor's 14 saved recordings is exactly this. The read path must
 * resolve it through `playableRecordingUrl` instead of handing it to a player.
 */
export function needsSignedResolution(stored?: string | null): boolean {
  const v = String(stored || '').trim();
  if (!v) return false;
  if (!/^https?:\/\//i.test(v)) return true; // a bare R2 key
  return /\/storage\/v1\/object\/public\//i.test(v) && /supabase\.co/i.test(v);
}
