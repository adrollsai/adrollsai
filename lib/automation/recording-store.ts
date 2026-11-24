/**
 * Storing a call recording in Cloudflare R2, and minting a URL to play it.
 *
 * WHY R2
 * Owner instruction: "don't save the recordings in supabase, save them in r2." The
 * Supabase bucket failed in the field as well: `lead-voice-recordings` does not exist in
 * the Procolor project at all, so every upload there came back "bucket not found" and
 * the recording was lost, leaving only the carrier's temporary URL on the lead.
 *
 * ONE PLACE DECIDES THE BUCKET
 * Bucket resolution used to be scattered and disagreeing: a hardcoded
 * `lead-voice-recordings` in the Supabase paths, and
 * `R2_BUCKET || R2_BUCKET_NAME || 'adrolls-storage'` inline in the CRM upload route.
 * `recordingBucket()` is now the only answer, so pointing recordings at a different
 * bucket — including a private one — is an env change and nothing else.
 *
 * WHAT IS STORED
 * A BARE OBJECT KEY (`recordings/<lead>/<file>.mp3`), never a URL. A URL is a promise
 * about where the object is reachable, and that promise changes: this bucket is served
 * publicly today, and the same object has to keep playing if it is made private
 * tomorrow. The key is stable; the URL is minted per play by `playableRecordingUrl`.
 */
// Type-only, so it is erased at compile time.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RECORDING_KEY_PREFIX,
  RECORDING_LINK_TTL_SECONDS,
  r2RecordingKey,
  signedRecordingUrl,
} from './recording-link';

/**
 * The bucket recordings live in.
 *
 * `R2_RECORDINGS_BUCKET` wins when set, so recordings can be moved to their own
 * (private) bucket without touching a single call site. Otherwise they share the
 * platform bucket — the same one every other asset already uses, which is what makes
 * this work today with no new infrastructure.
 */
export function recordingBucket(): string {
  const explicit = (process.env.R2_RECORDINGS_BUCKET || '').replace(/^["']|["']$/g, '').trim();
  if (explicit) return explicit;
  // utils/r2.ts owns the platform bucket default, so there is still exactly one.
  return process.env.R2_BUCKET_NAME || 'adrolls-storage';
}

/**
 * The key a recording is stored under. Lead first so a lead's recordings stay together,
 * and so a lifecycle rule can expire them per lead if that is ever wanted.
 */
export function recordingObjectKey(leadId: string | null | undefined, filename: string): string {
  const owner = String(leadId || 'unassigned').replace(/[^a-zA-Z0-9._-]/g, '');
  const name = String(filename || 'recording.mp3')
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${RECORDING_KEY_PREFIX}${owner || 'unassigned'}/${name}`;
}

export interface StoredRecording {
  /** The bare object key. This is what belongs in the database. */
  key: string;
  bucket: string;
}

/**
 * Upload a recording to R2 and return the key to persist.
 *
 * Returns null on failure and never throws: every call site has a carrier URL in hand
 * already, and a failed archival must not lose the call record — it should just leave
 * the lead pointing at the carrier, exactly as it did before this module existed.
 */
export async function storeRecording(input: {
  leadId?: string | null;
  filename: string;
  body: Uint8Array | Buffer;
  contentType?: string;
}): Promise<StoredRecording | null> {
  const key = recordingObjectKey(input.leadId, input.filename);
  const bucket = recordingBucket();
  try {
    const [{ PutObjectCommand }, { r2 }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@/utils/r2'),
    ]);
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType || 'audio/mpeg',
      })
    );
    return { key, bucket };
  } catch (err: any) {
    console.error(
      `[recording-store] R2 upload failed (bucket ${bucket}, key ${key}):`,
      err?.message || err
    );
    return null;
  }
}

/**
 * A short-lived presigned GET for an R2 recording.
 *
 * Presigned rather than public so this keeps working, unchanged, if the bucket is made
 * private — which is the right end state for customer phone calls.
 */
export async function presignedRecordingUrl(
  key: string,
  ttlSeconds: number = RECORDING_LINK_TTL_SECONDS
): Promise<string | null> {
  try {
    const [{ GetObjectCommand }, { getSignedUrl }, { getR2Client }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
      import('@/utils/r2'),
    ]);
    return await getSignedUrl(
      getR2Client(),
      new GetObjectCommand({ Bucket: recordingBucket(), Key: key }),
      { expiresIn: Math.max(60, Math.floor(ttlSeconds)) }
    );
  } catch (err: any) {
    console.warn('[recording-store] could not presign', key, err?.message || err);
    return null;
  }
}

/**
 * A playable URL for any stored recording, whichever era it was stored in: an R2 key is
 * presigned, a legacy Supabase value is signed through the old bucket. Null when there
 * is nothing we can play.
 */
export async function playableRecordingUrl(
  admin: SupabaseClient,
  stored?: string | null,
  ttlSeconds: number = RECORDING_LINK_TTL_SECONDS
): Promise<string | null> {
  const key = r2RecordingKey(stored);
  if (key) return presignedRecordingUrl(key, ttlSeconds);
  return signedRecordingUrl(admin, stored, ttlSeconds);
}

/** Same, but resolving the stored value for a lead first. */
export async function playableRecordingUrlForLead(
  admin: SupabaseClient,
  leadId: string,
  ttlSeconds?: number
): Promise<string | null> {
  const { data } = await admin
    .from('leads')
    .select('voice_recording_url')
    .eq('id', leadId)
    .maybeSingle();
  return playableRecordingUrl(admin, (data as any)?.voice_recording_url, ttlSeconds);
}
