/**
 * Read an image's dimensions, and say whether it can actually be advertised.
 *
 * WHY THIS EXISTS
 * Meta accepts almost any image and then complains later, in `issues_info`, with
 * something like "The 191x100 crop key for image ads is deprecated" (2490085) or a
 * low-coverage warning nobody reads. The advertiser's experience is: the campaign
 * "launched", and then an ad silently fails to serve.
 *
 * The checks here are deliberately split:
 *   - `readImageSize` parses the header of a PNG / JPEG / GIF / WebP buffer. No
 *     dependency, no decoding, no network — 32 bytes of PNG tell us everything.
 *   - `checkCreative` compares that against Meta's own placement limits and returns
 *     `blocked` only for an image Meta is certain to refuse, `warning` for one that
 *     will serve badly in some placements, `ok` otherwise.
 *
 * Blocking is intentionally conservative. A launch must not be stopped because our
 * header parser could not read a file; it is stopped only when we are certain.
 */

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

export interface ImageSize {
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'gif' | 'webp';
}

/** How many bytes we need for any of the supported headers. */
export const HEADER_SAMPLE_BYTES = 64 * 1024;

function readPng(view: DataView, bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null;
  // 89 50 4E 47 0D 0A 1A 0A, then an IHDR chunk with width/height as big-endian u32.
  return {
    format: 'png',
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

function readGif(view: DataView, bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 10) return null;
  return {
    format: 'gif',
    // GIF stores both as little-endian u16 after the 6-byte signature.
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
  };
}

function readWebp(view: DataView, bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === 'VP8X') {
    // 24-bit little-endian width-1 / height-1.
    const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { format: 'webp', width: w, height: h };
  }
  if (chunk === 'VP8 ') {
    return {
      format: 'webp',
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const b = bytes;
    if (b.length < 25) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return {
      format: 'webp',
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    };
  }
  return null;
}

function readJpeg(view: DataView, bytes: Uint8Array): ImageSize | null {
  // Walk the segment table looking for a Start-Of-Frame marker; the dimensions live
  // there. SOF0/1/2/3/5/6/7/9/10/11/13/14/15 all carry them; C4/C8/CC do not.
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        format: 'jpeg',
        height: view.getUint16(offset + 5, false),
        width: view.getUint16(offset + 7, false),
      };
    }
    const length = view.getUint16(offset + 2, false);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/**
 * Dimensions from the first bytes of an image, or `null` when this is not an image
 * we recognise (a video, an HTML error page, a truncated buffer…).
 */
export function readImageSize(bytes: Uint8Array | ArrayBuffer): ImageSize | null {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length < 12) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return readPng(view, buf);
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return readGif(view, buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return readJpeg(view, buf);
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return readWebp(view, buf);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Placement rules
// ---------------------------------------------------------------------------

/** Meta's own hard ceiling for an image upload. */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
/** Below this, Meta's reviewer rejects the image for feed placements. */
export const MIN_IMAGE_WIDTH = 400;
export const MIN_IMAGE_HEIGHT = 400;
/** The ratio band Meta serves in the feed without letterboxing: 1:1 … 1.91:1. */
export const FEED_RATIO_MIN = 1 / 1.91;
export const FEED_RATIO_MAX = 1.91;
/** Story / Reel wants 9:16; 4:5 is the tallest that still works in feed. */
export const STORY_RATIO = 9 / 16;

export type CreativeLevel = 'ok' | 'warning' | 'blocked';

export interface CreativeIssue {
  code: string;
  message: string;
}

export interface CreativeCheck {
  level: CreativeLevel;
  /** True only when Meta is certain to refuse the creative. */
  blocked: boolean;
  issues: CreativeIssue[];
  /** Which placements this creative can serve, best-effort, for the operator. */
  placements: string[];
  /** One line for the job log / launch message. */
  summary: string;
}

export interface CreativeCheckInput {
  kind: 'image' | 'video';
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  /** True when the metadata could not be read (URL unreachable, header unknown). */
  sizeUnknown?: boolean;
}

/**
 * Judge a creative against Meta's placement limits.
 *
 * An image that is too small or the wrong shape is a *warning* — it can still serve in
 * the placements it fits, and Meta will simply restrict it. It is `blocked` only when
 * Meta's own upload would fail, which in practice means an absurd or missing geometry
 * or a file over the 30 MB ceiling.
 */
export function checkCreative(input: CreativeCheckInput): CreativeCheck {
  const issues: CreativeIssue[] = [];
  const placements: string[] = [];
  const width = Number(input.width) || 0;
  const height = Number(input.height) || 0;
  const bytes = Number(input.bytes) || 0;

  if (input.kind === 'video') {
    if (bytes > 4 * 1024 * 1024 * 1024) {
      issues.push({ code: 'video_too_large', message: 'Video is over Meta\'s 4 GB upload limit.' });
    }
    if (width && height) {
      const ratio = width / height;
      if (Math.abs(ratio - STORY_RATIO) < 0.02) placements.push('stories, reels');
      else if (Math.abs(ratio - 1) < 0.02) placements.push('feed (square)');
      else if (Math.abs(ratio - 0.8) < 0.02) placements.push('feed (4:5)');
      else if (Math.abs(ratio - 16 / 9) < 0.02) placements.push('feed (landscape), in-stream');
      else placements.push('feed (letterboxed)');
    }
    const level: CreativeLevel = issues.some((i) => i.code === 'video_too_large') ? 'blocked' : 'ok';
    return {
      level,
      blocked: level === 'blocked',
      issues,
      placements,
      summary: level === 'blocked' ? issues[0].message : 'video accepted by Meta\'s size rules',
    };
  }

  if (input.sizeUnknown || !width || !height) {
    // Honest answer rather than a guess: we could not read the header, so we say so
    // and let Meta decide. Never a blocker.
    return {
      level: 'warning',
      blocked: false,
      issues: [{ code: 'size_unknown', message: 'The image dimensions could not be read, so placement coverage is unknown.' }],
      placements,
      summary: 'image checked by Meta only (dimensions unreadable locally)',
    };
  }

  if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) {
    issues.push({
      code: 'too_small',
      message: `Image is ${width}×${height}. Meta needs at least ${MIN_IMAGE_WIDTH}×${MIN_IMAGE_HEIGHT} to serve it in the feed.`,
    });
  }
  if (Math.min(width, height) < 200) {
    issues.push({ code: 'unusable', message: `Image is ${width}×${height}, too small for any placement.` });
  }
  if (bytes > MAX_IMAGE_BYTES) {
    issues.push({ code: 'too_large', message: `Image is ${Math.round(bytes / 1024 / 1024)} MB; Meta's limit is 30 MB.` });
  }

  const ratio = width / height;
  if (ratio > FEED_RATIO_MAX) {
    issues.push({
      code: 'too_wide',
      message: `Aspect ratio ${ratio.toFixed(2)}:1 is wider than Meta's 1.91:1 feed limit; sides will be cropped.`,
    });
  }
  if (ratio < FEED_RATIO_MIN) {
    issues.push({
      code: 'too_tall',
      message: `Aspect ratio ${ratio.toFixed(2)}:1 is taller than Meta's 1:1.91 feed limit; it will be cropped in feed.`,
    });
  }

  if (Math.abs(ratio - 1) < 0.05) placements.push('feed (square)', 'carousel');
  else if (Math.abs(ratio - 0.8) < 0.05) placements.push('feed (4:5 portrait)');
  else if (Math.abs(ratio - 1.91) < 0.05) placements.push('feed (1.91:1 landscape)');
  else if (Math.abs(ratio - STORY_RATIO) < 0.05) placements.push('stories, reels');
  else placements.push('feed (cropped to fit)');
  if (width >= 1080 && height >= 1080) placements.push('high-resolution feed');

  const blocked = issues.some((i) => i.code === 'unusable' || i.code === 'too_large');
  const level: CreativeLevel = blocked ? 'blocked' : issues.length ? 'warning' : 'ok';

  return {
    level,
    blocked,
    issues,
    placements,
    summary: blocked
      ? issues.find((i) => i.code === 'unusable' || i.code === 'too_large')!.message
      : issues.length
        ? `${width}×${height} (${issues.map((i) => i.code).join(', ')})`
        : `${width}×${height}, fits ${placements[0] || 'feed'}`,
  };
}

/**
 * Fetch just enough of an image to read its header and length.
 *
 * Uses a Range request so a 20 MB creative costs one 64 KB round trip. Returns
 * `sizeUnknown` rather than throwing: a CDN that ignores Range, a video URL, or a
 * transient error must not stop a launch.
 */
export async function inspectRemoteImage(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<CreativeCheck> {
  try {
    const res = await fetchImpl(url, {
      headers: { Range: `bytes=0-${HEADER_SAMPLE_BYTES - 1}` },
      cache: 'no-store',
    });
    if (!res.ok && res.status !== 206) {
      return checkCreative({ kind: 'image', sizeUnknown: true });
    }
    const contentLength = Number(res.headers.get('content-length')) || 0;
    const contentRange = res.headers.get('content-range') || '';
    const totalFromRange = /\/(\d+)$/.exec(contentRange)?.[1];
    const buffer = new Uint8Array(await res.arrayBuffer());
    const size = readImageSize(buffer);
    const bytes = totalFromRange ? Number(totalFromRange) : contentLength;
    if (!size) return checkCreative({ kind: 'image', bytes, sizeUnknown: true });
    return checkCreative({ kind: 'image', width: size.width, height: size.height, bytes });
  } catch {
    return checkCreative({ kind: 'image', sizeUnknown: true });
  }
}
