/**
 * Playing a call recording without making it public.
 *
 * THE PROBLEM
 * The `lead-voice-recordings` bucket was public, and the stream route wrote
 * `getPublicUrl(...)` into `leads.voice_recording_url`. That means every call
 * recording of every customer was fetchable by anyone holding the URL, and the URL
 * is guessable: `<lead id>/vobiz_<provider id>_<timestamp>.mp3`. A public bucket of
 * customer phone calls is not a storage setting, it is a data leak with a CDN in
 * front of it.
 *
 * WHAT REPLACES IT
 * The bucket is private. A recording is reached with a short-lived signed URL,
 * created on demand:
 *
 *   stored value                     -> playable URL
 *   ----------------------------------------------------------------------
 *   "<lead>/vobiz_..._123.mp3"        -> signed storage URL (TTL)
 *   ".../object/public/lead-voice-…"  -> signed storage URL (TTL), path extracted
 *   "https://media.vobiz.ai/..."      -> null here; the stream route proxies it
 *
 * Every caller that used to just hand the stored string to a human now goes
 * through this, so there is one place to reason about the exposure.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const RECORDING_BUCKET = 'lead-voice-recordings';

/** How long a playback link stays valid. Long enough to click, short enough to matter. */
export const RECORDING_LINK_TTL_SECONDS = 60 * 60;

/**
 * The object path inside the bucket, from any of the shapes that have been stored:
 * a bare path, a `/object/public/<bucket>/<path>` URL, or a signed
 * `/object/sign/<bucket>/<path>?token=…` URL.
 */
export function recordingStoragePath(stored?: string | null): string | null {
  const value = String(stored ?? '').trim();
  if (!value) return null;

  // A bare object path, as this module writes from now on.
  if (!/^https?:\/\//i.test(value)) {
    const clean = value.replace(/^\/+/, '');
    return clean.includes('/') ? clean : null;
  }

  // Our own bucket, in any of Supabase's URL forms.
  const markers = [`/object/public/${RECORDING_BUCKET}/`, `/object/sign/${RECORDING_BUCKET}/`];
  for (const marker of markers) {
    const at = value.indexOf(marker);
    if (at === -1) continue;
    const rest = value.slice(at + marker.length).split('?')[0];
    try {
      return decodeURIComponent(rest) || null;
    } catch {
      return rest || null;
    }
  }
  return null;
}

/** Is this stored value a recording we host ourselves? */
export function isOurRecording(stored?: string | null): boolean {
  return recordingStoragePath(stored) !== null;
}

/**
 * A playable URL for a stored recording, or null when there is nothing we can play.
 *
 * The client passed in must be service-role: signing a URL for a private object
 * is an administrative act, and the caller is already doing that work on the
 * owner's behalf.
 */
export async function signedRecordingUrl(
  admin: SupabaseClient,
  stored?: string | null,
  ttlSeconds: number = RECORDING_LINK_TTL_SECONDS
): Promise<string | null> {
  const path = recordingStoragePath(stored);
  if (!path) return null;
  try {
    const { data, error } = await admin.storage
      .from(RECORDING_BUCKET)
      .createSignedUrl(path, Math.max(60, Math.floor(ttlSeconds)));
    if (error || !data?.signedUrl) {
      console.warn('[recording-link] could not sign', path, error?.message);
      return null;
    }
    return data.signedUrl;
  } catch (err: any) {
    console.warn('[recording-link] signing threw:', err?.message || err);
    return null;
  }
}

/** Same, but resolving the stored value for a lead first. */
export async function signedRecordingUrlForLead(
  admin: SupabaseClient,
  leadId: string,
  ttlSeconds?: number
): Promise<string | null> {
  const { data } = await admin
    .from('leads')
    .select('voice_recording_url')
    .eq('id', leadId)
    .maybeSingle();
  return signedRecordingUrl(admin, (data as any)?.voice_recording_url, ttlSeconds);
}
