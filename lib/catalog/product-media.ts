/**
 * A product's own media: what a business can attach to an offering, and how the agent sees it.
 *
 * WHY THIS EXISTS
 * The catalogue said what a business SELLS; the file manager held its FILES. Nothing joined
 * them, so "make a creative for Batch 12" had no way to reach the photographs of Batch 12,
 * and the agent either used nothing or used whatever was newest. That is the difference
 * between a creative that looks like the business and one that looks like a stock photo.
 *
 * WHAT IS ENFORCED HERE, AND WHY IN CODE
 * Upload limits live here rather than in a database constraint because they differ by kind
 * and because a studio owner needs a sentence explaining the refusal, not a 23514 from
 * Postgres. The numbers are deliberately modest — this is a phone-first product and storage
 * is the one cost that grows without anybody noticing:
 *
 *   image     10 MB, 20 per product
 *   video     50 MB,  5 per product
 *   document  10 MB, 10 per product
 *
 * PURE: no upload, no I/O. The caller does the transfer; this decides what is allowed and
 * describes the result.
 */

export type MediaKind = 'image' | 'video' | 'document';

export interface MediaLimits {
  /** Largest single file, in bytes. */
  maxBytes: number;
  /** Most of this kind one product may carry. */
  maxPerProduct: number;
  /** Human label for the refusal message. */
  label: string;
}

export const MEDIA_LIMITS: Record<MediaKind, MediaLimits> = {
  image: { maxBytes: 10 * 1024 * 1024, maxPerProduct: 20, label: 'photo' },
  video: { maxBytes: 50 * 1024 * 1024, maxPerProduct: 5, label: 'video' },
  document: { maxBytes: 10 * 1024 * 1024, maxPerProduct: 10, label: 'document' },
};

/** Extensions we accept, by kind. MIME types are unreliable across Android share sheets. */
const EXTENSIONS: Record<MediaKind, readonly string[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic'],
  video: ['mp4', 'mov', 'm4v', 'webm'],
  document: ['pdf', 'doc', 'docx', 'txt', 'csv', 'xls', 'xlsx'],
};

/** `photo.JPG` -> `jpg`. */
export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename ?? '').trim());
  return match ? match[1].toLowerCase() : '';
}

/** Which kind a file is, from its extension. Unknown extensions are not guessed. */
export function kindOf(filename: string): MediaKind | null {
  const extension = extensionOf(filename);
  if (!extension) return null;
  for (const kind of ['image', 'video', 'document'] as const) {
    if (EXTENSIONS[kind].includes(extension)) return kind;
  }
  return null;
}

export function megabytes(bytes: number): string {
  return `${Math.round((Number(bytes) || 0) / (1024 * 1024) * 10) / 10} MB`;
}

export interface UploadCandidate {
  name: string;
  size: number;
}

export interface UploadVerdict {
  ok: boolean;
  kind?: MediaKind;
  /** Why it was refused, in words an owner can act on. */
  reason?: string;
}

/**
 * May this file be attached to this product?
 *
 * `attached` is how many of that kind the product already carries, so the per-product cap is
 * checked against reality rather than assumed.
 */
export function checkUpload(file: UploadCandidate, attached: Partial<Record<MediaKind, number>> = {}): UploadVerdict {
  const name = String(file?.name ?? '').trim();
  const size = Number(file?.size ?? 0);

  const kind = kindOf(name);
  if (!kind) {
    const extension = extensionOf(name) || '(none)';
    return {
      ok: false,
      reason:
        `"${name}" is a .${extension} file, which this catalogue does not take. ` +
        'Photos (JPG, PNG, WebP), videos (MP4, MOV) and documents (PDF, Word, Excel, CSV) are fine.',
    };
  }

  const limits = MEDIA_LIMITS[kind];
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, kind, reason: `"${name}" looks empty — it may not have uploaded properly.` };
  }
  if (size > limits.maxBytes) {
    return {
      ok: false,
      kind,
      reason:
        `That ${limits.label} is ${megabytes(size)}; the limit is ${megabytes(limits.maxBytes)}. ` +
        (kind === 'video' ? 'Trim it, or send a shorter clip.' : 'Shrink it and try again.'),
    };
  }

  const already = Number(attached[kind] ?? 0);
  if (already >= limits.maxPerProduct) {
    return {
      ok: false,
      kind,
      reason:
        `This product already has ${already} ${limits.label}${already === 1 ? '' : 's'}, which is the limit. ` +
        'Remove one first, or attach this to a different product.',
    };
  }

  return { ok: true, kind };
}

// ────────────────────────────────────────────────────────────────────────────
// What the agent sees
// ────────────────────────────────────────────────────────────────────────────

export interface ProductMediaRow {
  id: string;
  url: string;
  type?: string | null;
  caption?: string | null;
  product_id?: string | null;
}

export interface ProductMediaSummary {
  productId: string;
  counts: Record<MediaKind, number>;
  /** Images first, then video, then documents — the order a creative would use them in. */
  images: { id: string; url: string; caption: string }[];
  videos: { id: string; url: string; caption: string }[];
  documents: { id: string; url: string; caption: string }[];
  total: number;
}

/** Group a product's files into what the agent can actually use. */
export function summariseProductMedia(productId: string, rows: readonly ProductMediaRow[]): ProductMediaSummary {
  const mine = rows.filter((row) => String(row.product_id ?? '') === String(productId));
  const describe = (row: ProductMediaRow) => ({
    id: String(row.id),
    url: String(row.url),
    caption: String(row.caption ?? '').trim(),
  });

  const images = mine.filter((row) => kindOf(row.caption ? `${row.caption}` : '') === 'image' || row.type === 'image' || isImageUrl(row.url));
  const videos = mine.filter((row) => !images.includes(row) && (row.type === 'video' || isVideoUrl(row.url)));
  const documents = mine.filter((row) => !images.includes(row) && !videos.includes(row));

  return {
    productId: String(productId),
    counts: { image: images.length, video: videos.length, document: documents.length },
    images: images.map(describe),
    videos: videos.map(describe),
    documents: documents.map(describe),
    total: mine.length,
  };
}

/** An asset row records its kind in `type`, but older rows do not — fall back to the URL. */
export function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|webp|avif|heic)(\?|$)/i.test(String(url ?? ''));
}
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(String(url ?? ''));
}

/**
 * One block of text for the agent's context.
 *
 * Capped on purpose: a product with 35 files must not push 35 URLs into a prompt. The agent
 * is told how many there are and given the first few, so it can ask for more if it needs
 * them rather than paying for all of them every turn.
 */
export function mediaBriefForAgent(summary: ProductMediaSummary, options: { limit?: number } = {}): string {
  const limit = Math.max(1, Math.min(12, options.limit ?? 6));
  if (summary.total === 0) {
    return (
      'This product has no media attached. Ask the owner for photos or footage of the actual ' +
      'thing before making a creative that shows it — do not substitute a stock image without saying so.'
    );
  }

  const lines: string[] = [
    `This product has ${summary.counts.image} photo(s), ${summary.counts.video} video(s) and ` +
      `${summary.counts.document} document(s). Use THESE rather than inventing imagery.`,
  ];

  for (const [kind, entries] of [
    ['photo', summary.images],
    ['video', summary.videos],
    ['document', summary.documents],
  ] as const) {
    if (!entries.length) continue;
    lines.push(`${kind}:`);
    for (const entry of entries.slice(0, limit)) {
      lines.push(`  - ${entry.caption || entry.id}: ${entry.url}`);
    }
    if (entries.length > limit) lines.push(`  …and ${entries.length - limit} more`);
  }

  return lines.join('\n');
}
