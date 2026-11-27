/**
 * Reading a stored call recording: what shape is this value, and where does it live?
 *
 * WHERE RECORDINGS LIVE NOW
 * New recordings go to Cloudflare R2 (see lib/automation/recording-store.ts). Older
 * ones live in the private Supabase bucket `lead-voice-recordings`, and several of them
 * were stored as a `…/object/public/…` URL before that bucket was made private. Both
 * must keep playing, so this module is the one place that knows the difference, and it
 * stays free of storage SDK imports on purpose: it is pure value parsing, which lets the
 * offline gates bundle it without dragging the AWS SDK in.
 *
 * THE PRIVACY RULE, which has not changed
 * The Supabase bucket was public, and the stream route wrote `getPublicUrl(...)` into
 * `leads.voice_recording_url`. That meant every call recording of every customer was
 * fetchable by anyone holding the URL, and the URL is guessable:
 * `<lead id>/vobiz_<provider id>_<timestamp>.mp3`. A public bucket of customer phone
 * calls is not a storage setting, it is a data leak with a CDN in front of it.
 *
 * So a recording is never handed out as a stored URL. It is reached with a short-lived
 * URL minted on demand:
 *
 *   stored value                          -> playable URL
 *   ---------------------------------------------------------------------------
 *   "recordings/<lead>/vobiz_..._1.mp3"    -> presigned R2 GET (TTL)   [current]
 *   "<lead>/vobiz_..._123.mp3"             -> signed Supabase URL (TTL) [legacy]
 *   ".../object/public/lead-voice-…"       -> signed Supabase URL (TTL), path extracted
 *   "https://media.vobiz.ai/..."           -> null here; the stream route proxies it
 *
 * WHY THE `recordings/` PREFIX MATTERS
 * A bare `<lead>/<file>.mp3` and a bare `recordings/<lead>/<file>.mp3` look identical to
 * a "does it contain a slash" test, so the prefix is what tells an R2 key apart from a
 * legacy Supabase path. Without it, every new recording would be signed against a bucket
 * that does not hold it and playback would 500.
 */
// Type-only, so it is erased at compile time: this module stays free of runtime imports.
import type { SupabaseClient } from '@supabase/supabase-js';

/** The prefix that marks an R2 object key as a call recording. */
export const RECORDING_KEY_PREFIX = 'recordings/';

/**
 * The Supabase bucket recordings were written to before the move to R2. Nothing new is
 * uploaded here; it is kept so existing rows keep resolving.
 */
export const LEGACY_RECORDING_BUCKET = 'lead-voice-recordings';

/** How long a playback link stays valid. Long enough to click, short enough to matter. */
export const RECORDING_LINK_TTL_SECONDS = 60 * 60;

/**
 * The R2 object key for a stored value, when that value is an R2 recording.
 *
 * Accepts the bare key this codebase writes, and also a full URL (public or already
 * presigned) whose path carries the key — presigned links are what the CRM renders, and
 * one of those can be written back onto a lead by a careless round trip.
 */
export function r2RecordingKey(stored?: string | null): string | null {
  const value = String(stored ?? '').trim();
  if (!value) return null;

  // A bare object key, which is what recording-store writes.
  if (!/^https?:\/\//i.test(value)) {
    const clean = value.replace(/^\/+/, '');
    return clean.startsWith(RECORDING_KEY_PREFIX) ? clean : null;
  }

  // Any URL carrying /recordings/ in its path. A Supabase URL encodes the bucket as
  // `lead-voice-recordings/`, whose character before `recordings` is `-`, so this
  // cannot mistake a legacy Supabase URL for an R2 key.
  const match = value.match(/\/recordings\/[^?#]+/);
  if (!match) return null;
  const key = match[0].slice(1);
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/** Is this stored value an R2 recording? */
export function isR2Recording(stored?: string | null): boolean {
  return r2RecordingKey(stored) !== null;
}

/**
 * The object path inside the LEGACY Supabase bucket, from any of the shapes that have
 * been stored there: a bare path, a `/object/public/<bucket>/<path>` URL, or a signed
 * `/object/sign/<bucket>/<path>?token=…` URL.
 *
 * Returns null for an R2 key: that object is not in this bucket, and signing it here
 * would only produce a 404.
 */
export function recordingStoragePath(stored?: string | null): string | null {
  const value = String(stored ?? '').trim();
  if (!value) return null;
  if (r2RecordingKey(value)) return null;

  // A bare object path, as the stream route wrote before the move to R2.
  if (!/^https?:\/\//i.test(value)) {
    const clean = value.replace(/^\/+/, '');
    return clean.includes('/') ? clean : null;
  }

  // Our own bucket, in any of Supabase's URL forms.
  const markers = [
    `/object/public/${LEGACY_RECORDING_BUCKET}/`,
    `/object/sign/${LEGACY_RECORDING_BUCKET}/`,
  ];
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

/**
 * Is this stored value a recording we host ourselves (R2 today, Supabase before)?
 *
 * Callers use this to decide "never hand this string to a human or to Meta — it is not
 * directly fetchable, route it through the signed stream route instead".
 */
export function isOurRecording(stored?: string | null): boolean {
  return r2RecordingKey(stored) !== null || recordingStoragePath(stored) !== null;
}

/**
 * A short-lived Supabase URL for a legacy recording, or null when there is nothing we
 * can play. New recordings are played by `playableRecordingUrl` in
 * lib/automation/recording-store.ts; this stays for the rows that are still in Supabase.
 *
 * The client passed in must be service-role: signing a URL for a private object is an
 * administrative act, and the caller is already doing that work on the owner's behalf.
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
      .from(LEGACY_RECORDING_BUCKET)
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
