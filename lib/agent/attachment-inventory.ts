/**
 * Ingesting what the owner attached, so their own footage can outrank generation.
 *
 * WHY THIS EXISTS
 * An operator's own clip of their own project is FREE and TRUE. A generated stand-in is neither —
 * it costs credits, and if it is standing in for a real product it is a lie. So before anything is
 * planned, every attachment is measured and described into an inventory the planner can cite:
 *
 *     "0:12–0:19 uses your clip 2 — 12s, 9:16, shows the tower at dusk"
 *
 * The split here matters:
 *   - everything in this file that DECIDES anything is pure and tested (parsing, aspect labels,
 *     usability, ranking, the summary text);
 *   - the two things that need the outside world — `ffprobe` and a vision description — are
 *     injected through `InventoryDeps`.
 *
 * Why injected: `ffprobe` does not exist in a Vercel function. The real implementations belong in
 * the E2B sandbox this repo already uses for media work, or in the existing vision tool, and neither
 * should be reachable from a unit test. A missing probe is reported as "unmeasured", never guessed.
 */

import type { AttachmentInventoryItem } from './video-plan';

/** What a media probe can tell us. Everything optional except the length and whether there is audio. */
export interface MediaProbe {
  seconds: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  videoCodec?: string;
  /** Set when the file could not be read at all. */
  error?: string;
}

/** What a vision pass can tell us about the content. */
export interface VisionNote {
  /** One sentence: what is actually in the clip. */
  shows: string;
  /** Burnt-in text, a caption bar, a logo bug — anything that would fight our own overlays. */
  hasBurnedInText?: boolean;
  /** A visible watermark or letterbox that would need cropping. */
  hasWatermark?: boolean;
}

/** The outside world, injected. Both may be absent; absence is reported, never invented. */
export interface InventoryDeps {
  probe(url: string): Promise<MediaProbe | null>;
  describe?(url: string): Promise<VisionNote | null>;
}

export interface AttachmentSource {
  id: string;
  kind: 'video' | 'image';
  /** A public https URL or an R2 key the caller has already resolved. */
  url?: string;
  /** A filename the owner recognises, echoed back in the summary. */
  name?: string;
  /**
   * The range the owner said is relevant, in seconds. The owner knows their own footage better
   * than a probe does, so this wins over the measured length when present.
   */
  usableRange?: { from: number; to: number };
}

/** A `9:16` style label from pixel dimensions. Falls back to the nearest common placement. */
export function aspectLabelFor(width?: number, height?: number): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const ratio = width / height;
  const known: { label: string; value: number }[] = [
    { label: '9:16', value: 9 / 16 },
    { label: '4:5', value: 4 / 5 },
    { label: '1:1', value: 1 },
    { label: '16:9', value: 16 / 9 },
    { label: '3:4', value: 3 / 4 },
    { label: '4:3', value: 4 / 3 },
  ];
  let best = known[0];
  for (const k of known) {
    if (Math.abs(k.value - ratio) < Math.abs(best.value - ratio)) best = k;
  }
  // within 4% is close enough to call it that placement; otherwise report the raw ratio
  return Math.abs(best.value - ratio) / best.value <= 0.04
    ? best.label
    : `${width}x${height}`;
}

/**
 * Parse `ffprobe -print_format json -show_streams -show_format` output.
 *
 * Returns null rather than throwing on anything unrecognisable: an unreadable attachment must not
 * stop a job, it must be reported as unmeasured and left out of the ranking.
 */
export function parseFfprobeJson(raw: unknown): MediaProbe | null {
  let j: any = raw;
  if (typeof raw === 'string') {
    try {
      j = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!j || typeof j !== 'object') return null;

  const streams: any[] = Array.isArray(j.streams) ? j.streams : [];
  const video = streams.find((s) => s?.codec_type === 'video');
  const audio = streams.find((s) => s?.codec_type === 'audio');
  const seconds = Number(j?.format?.duration ?? video?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  return {
    seconds,
    width: Number(video?.width) || undefined,
    height: Number(video?.height) || undefined,
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ? String(video.codec_name) : undefined,
  };
}

/** How many seconds of this attachment are usable. */
export function usableSeconds(item: AttachmentInventoryItem): number {
  if (item.usableRange) {
    const span = item.usableRange.to - item.usableRange.from;
    return span > 0 ? span : 0;
  }
  return item.seconds ?? 0;
}

/**
 * Build one inventory row.
 *
 * A defect is any of: a watermark, burned-in text that would fight our overlays, or a file that
 * failed to probe. Defective items stay in the inventory — the operator needs to see WHY their clip
 * was not used — but `assignAttachments` skips them.
 */
export function buildInventoryItem(input: {
  source: AttachmentSource;
  probe: MediaProbe | null;
  vision?: VisionNote | null;
}): AttachmentInventoryItem {
  const { source, probe, vision } = input;
  // The reason, in the order that matters to the owner: an unreadable file beats a cosmetic
  // defect, because it is the one they can fix.
  const problem = !probe
    ? 'could not be measured — the file may be corrupt or the format is unsupported'
    : probe.error
      ? `could not be read: ${probe.error}`
      : vision?.hasWatermark
        ? 'has a visible watermark that would have to be cropped out'
        : vision?.hasBurnedInText
          ? 'has burned-in text that would fight our own overlays'
          : undefined;

  return {
    id: source.id,
    kind: source.kind,
    seconds: probe?.seconds,
    aspect: aspectLabelFor(probe?.width, probe?.height),
    shows: vision?.shows,
    usableRange: source.usableRange,
    hasOwnAudio: probe?.hasAudio,
    hasDefect: Boolean(problem),
    ...(problem ? { problem } : {}),
  };
}

/**
 * Probe and describe every attachment.
 *
 * Runs the probes concurrently because they are independent, and never lets one failure kill the
 * batch: a source that throws is recorded as unmeasured. Ask for `describe` only where a vision
 * dependency was supplied — an un-described clip is still usable, it just cannot be cited by
 * content.
 */
export async function inventoryAttachments(
  sources: readonly AttachmentSource[],
  deps: InventoryDeps,
): Promise<AttachmentInventoryItem[]> {
  const settled = await Promise.all(
    sources.map(async (source) => {
      if (!source.url) {
        return buildInventoryItem({ source, probe: null });
      }
      let probe: MediaProbe | null = null;
      try {
        probe = await deps.probe(source.url);
      } catch (err) {
        probe = { seconds: 0, hasAudio: false, error: err instanceof Error ? err.message : 'probe failed' };
      }
      let vision: VisionNote | null = null;
      if (deps.describe && source.kind === 'video' && probe && !probe.error) {
        try {
          vision = await deps.describe(source.url);
        } catch {
          vision = null;
        }
      }
      return buildInventoryItem({ source, probe, vision });
    }),
  );
  return settled;
}

/**
 * The inventory as the agent reads it out loud, before planning.
 *
 * Written as sentences rather than JSON because its job is to let the owner correct you: a clip
 * described wrongly is obvious here and invisible in a JSON blob.
 */
export function summariseInventory(
  items: readonly AttachmentInventoryItem[],
  names: Readonly<Record<string, string>> = {},
): string {
  if (items.length === 0) {
    return 'No attachments — every beat will be generated.';
  }
  const lines = items.map((item, i) => {
    const name = names[item.id] ?? item.id;
    const length = item.seconds ? `${item.seconds.toFixed(1)}s` : 'length unknown';
    const aspect = item.aspect ? `, ${item.aspect}` : '';
    const audio = item.hasOwnAudio ? ', has its own audio' : ', silent';
    const usable = item.usableRange
      ? `, usable ${item.usableRange.from.toFixed(1)}–${item.usableRange.to.toFixed(1)}s`
      : '';
    const shows = item.shows ? ` — ${item.shows}` : '';
    const problem = item.hasDefect
      ? `  ⚠ not used: ${item.problem ?? 'not usable as-is'}`
      : '';
    return `${i + 1}. ${name} (${length}${aspect}${audio}${usable})${shows}${problem}`;
  });

  const usableCount = items.filter((i) => !i.hasDefect && i.kind === 'video').length;
  const totalUsable = items
    .filter((i) => !i.hasDefect)
    .reduce((sum, i) => sum + usableSeconds(i), 0);

  lines.push(
    '',
    `${usableCount} of ${items.length} can cover a beat (${totalUsable.toFixed(1)}s of usable footage). ` +
      'Their own footage costs no credits and shows the real thing, so it is used before anything is generated.',
  );
  return lines.join('\n');
}

/**
 * Turn a product row from the catalogue into attachment sources.
 *
 * The app stores product media in more than one column (`video_urls`, `product_videos`, and a single
 * `video_url`), so this accepts the whole row and reads whichever is populated rather than making a
 * caller remember. Anything that is not an http(s) URL or an R2 key is skipped, never guessed at.
 */
export function sourcesFromProduct(
  product: Record<string, unknown> | null | undefined,
  idPrefix = 'product',
): AttachmentSource[] {
  if (!product) return [];
  const out: AttachmentSource[] = [];
  const seen = new Set<string>();

  const push = (kind: 'video' | 'image', url: unknown, n: number) => {
    const u = typeof url === 'string' ? url.trim() : '';
    if (!u || seen.has(u)) return;
    if (!/^https?:\/\//i.test(u) && !/^[A-Za-z0-9_\-/]+\.[A-Za-z0-9]+$/.test(u)) return;
    seen.add(u);
    out.push({ id: `${idPrefix}-${kind}-${n}`, kind, url: u, name: `${String(product.title ?? idPrefix)} ${kind} ${n}` });
  };

  const many = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    if (typeof v === 'string' && v.trim()) return [v];
    return [];
  };

  many(product.video_urls).forEach((u, i) => push('video', u, i + 1));
  many(product.product_videos).forEach((u, i) => push('video', u, out.filter((o) => o.kind === 'video').length + 1));
  many(product.video_url).forEach((u, i) => push('video', u, out.filter((o) => o.kind === 'video').length + 1));
  many(product.images).forEach((u, i) => push('image', u, i + 1));
  many(product.image_url).forEach((u, i) => push('image', u, out.filter((o) => o.kind === 'image').length + 1));
  many(product.brochure_url).forEach((u) => push('image', u, out.filter((o) => o.kind === 'image').length + 1));

  return out;
}
