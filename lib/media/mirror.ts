/**
 * Making a provider's short-lived media URL permanent.
 *
 * WHY THIS IS SHARED
 * Kie hands back URLs on a temporary host (`tempfile.aiquickdraw.com`, `kie.ai/…`) that
 * expire. Every finished generation therefore has to be copied into our own bucket before
 * it is stored — and "every" turned out to include paths that were not the tool that
 * generated it: a background sweep also has to be able to finish a paid render the agent
 * abandoned. Two copies of this logic would drift, and the copy that drifted would be the
 * one nobody watched.
 */
import { uploadBufferToR2 } from '@/lib/agent/sandbox';

/** Not every host likes a bare fetch; a browser UA avoids the cheapest refusals. */
const MIRROR_UA = 'Mozilla/5.0';

/**
 * Copy `url` into our bucket and return the permanent URL.
 *
 * Falls back to the original URL when the copy cannot be made: an expiring link is worse
 * than nothing but still better than an asset record pointing at "", and the caller has a
 * paid-for artefact either way. The failure is logged so it is visible rather than silent.
 */
export async function mirrorToR2(url: string, fileName: string, userId: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': MIRROR_UA } });
    if (!res.ok) {
      console.warn(`[media-mirror] Mirror skipped (${res.status}) for ${url.slice(0, 80)}`);
      return url;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return url;
    return await uploadBufferToR2(buffer, fileName, userId);
  } catch (err: any) {
    console.warn(`[media-mirror] Mirror failed: ${err?.message || err}`);
    return url;
  }
}

/** What a result URL is, from its extension. Images are the default. */
export function kindFromUrl(url: string): 'video' | 'audio' | 'image' {
  const path = url.split('?')[0].toLowerCase();
  if (/\.(mp4|mov|webm|m4v)$/.test(path)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(path)) return 'audio';
  return 'image';
}

/** The file extension a mirrored artefact should carry. */
export function extensionFor(kind: 'video' | 'audio' | 'image'): string {
  return kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png';
}
