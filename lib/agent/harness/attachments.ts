/**
 * Turns attachments referenced in a user message into real model content.
 *
 * The client serialises attachments as text:
 *   [Attached File: name (image)]
 *   URL: https://…
 *
 * Before this module existed the model only ever saw that text — the image was
 * never sent, so "vision" was a claim rather than behaviour (the route even
 * computed a `hasVision` flag that nothing used). Here the bytes are attached
 * as an `ImagePart` so `deepseek-flash` actually looks at the picture.
 */
export interface AttachedMedia {
  name: string;
  type: string;
  url: string;
}

const ATTACH_RE = /\[Attached File:\s*(.+?)\s*\(([^)]+)\)\]/gi;

/** Pull every attachment that carries a URL out of a message body. */
export function extractAttachments(text: string): AttachedMedia[] {
  if (typeof text !== 'string' || !text) return [];
  const out: AttachedMedia[] = [];

  for (const match of text.matchAll(ATTACH_RE)) {
    const name = (match[1] || '').trim();
    const type = (match[2] || '').trim().toLowerCase();
    const end = (match.index ?? 0) + match[0].length;
    // The URL follows within a short distance (the client puts it on the next line).
    const tail = text.slice(end, end + 400);
    const urlMatch = tail.match(/URL:\s*(https?:\/\/[^\s\n]+)/i);
    if (!urlMatch) continue;
    out.push({ name, type, url: urlMatch[1].trim() });
  }

  return out;
}

export function extractImageAttachments(text: string): AttachedMedia[] {
  return extractAttachments(text).filter((a) => a.type === 'image');
}

export function extractVideoAttachments(text: string): AttachedMedia[] {
  return extractAttachments(text).filter((a) => a.type === 'video');
}

/** What `ImagePart.image` accepts. */
export type ImageSource = { type: 'image'; image: Buffer | URL; mediaType?: string };

const MAX_INLINE_BYTES = 8 * 1024 * 1024;

function mediaTypeFor(url: string, headerType?: string | null): string {
  if (headerType && headerType.startsWith('image/')) return headerType;
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

/**
 * Load images as inline data so the provider does not have to fetch them.
 * Falls back to passing the URL when the bytes are too large or unreachable —
 * the provider can often fetch a public URL itself.
 */
export async function loadImageParts(
  attachments: AttachedMedia[],
  opts: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<ImageSource[]> {
  const maxBytes = opts.maxBytes ?? MAX_INLINE_BYTES;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const parts: ImageSource[] = [];

  for (const attachment of attachments) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(attachment.url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        console.warn(`[Harness] image fetch ${res.status} for ${attachment.name}; passing URL to the model instead`);
        parts.push({ type: 'image', image: new URL(attachment.url), mediaType: mediaTypeFor(attachment.url) });
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0 || buffer.length > maxBytes) {
        console.warn(
          `[Harness] image ${attachment.name} is ${buffer.length} bytes (limit ${maxBytes}); passing URL instead`
        );
        parts.push({ type: 'image', image: new URL(attachment.url), mediaType: mediaTypeFor(attachment.url) });
        continue;
      }

      parts.push({
        type: 'image',
        image: buffer,
        mediaType: mediaTypeFor(attachment.url, res.headers.get('content-type')),
      });
    } catch (err: any) {
      console.warn(`[Harness] could not load image ${attachment.name} (${err?.message}); passing URL instead`);
      try {
        parts.push({ type: 'image', image: new URL(attachment.url), mediaType: mediaTypeFor(attachment.url) });
      } catch {
        /* unusable URL — drop this image rather than failing the turn */
      }
    }
  }

  return parts;
}
