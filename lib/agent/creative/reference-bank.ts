import bankJson from '../../../references/index.json';

/**
 * The reference bank.
 *
 * A reference is something the person pointed at and said "like this". It is the standard the
 * agent builds to: the agent picks the closest entry, rebuilds it with the tenant's own material,
 * and compares its output against the entry. Selection is cheap because every entry carries a
 * short summary plus measured facts (duration, aspect, cut count, average shot length), so the
 * agent can choose without watching anything twice.
 *
 * The bank deliberately contains no copy and no brand marks — it is a structure manifest, so
 * nothing here can leak a third party's identity into a tenant's artefact.
 */

export type ReferenceKind = 'video' | 'image' | 'page';

export interface VideoMeasurements {
  durationSec: number;
  width: number;
  height: number;
  aspect: string;
  orientation: string;
  fps: number;
  bitrateMbps: number | null;
  originalBytes: number;
  videoCodec: string;
  audioCodec: string;
  audioChannels: number | null;
  audioSampleRate: number | null;
  loudness: { meanDb: number | null; maxDb: number | null };
  cutCount: number;
  /** Seconds per shot, in order. */
  shots: number[];
  avgShotSec: number | null;
}

export interface VideoReference {
  id: string;
  kind: 'video';
  title: string;
  industry: string;
  goal: string;
  summary: string;
  measured: VideoMeasurements;
  assets: { proxyUrl: string; sheetUrl: string };
  source: { localPath: string; ingestedAt: string };
}

export interface ImageReference {
  id: string;
  kind: 'image';
  title: string;
  industry: string;
  summary: string;
  assets: { url: string };
}

export interface PageReference {
  id: string;
  kind: 'page';
  title: string;
  industry: string;
  summary: string;
  assets: { desktopUrl: string; mobileUrl?: string };
}

export interface BankIndex {
  videos: VideoReference[];
  images: ImageReference[];
  pages: PageReference[];
  updatedAt?: string;
}

const bank = bankJson as unknown as BankIndex;

export function videoReferences(): VideoReference[] {
  return bank.videos ?? [];
}

export function imageReferences(): ImageReference[] {
  return bank.images ?? [];
}

export function pageReferences(): PageReference[] {
  return bank.pages ?? [];
}

export function bankStatus(): { videos: number; images: number; pages: number; industries: string[] } {
  const all = [...videoReferences(), ...imageReferences(), ...pageReferences()];
  const industries = Array.from(new Set(all.map((r) => r.industry).filter(Boolean))).sort();
  return {
    videos: videoReferences().length,
    images: imageReferences().length,
    pages: pageReferences().length,
    industries,
  };
}

function industryScore(referenceIndustry: string, want?: string): number {
  if (!want) return 0;
  const a = referenceIndustry.toLowerCase().trim();
  const b = want.toLowerCase().trim();
  if (!a) return 0;
  if (a === b) return 3;
  if (a.includes(b) || b.includes(a)) return 2;
  const words = b.split(/[^a-z]+/).filter((w) => w.length > 3);
  return words.some((w) => a.includes(w)) ? 1 : 0;
}

/** References of one kind, best industry match first. */
export function referencesFor(kind: ReferenceKind, industry?: string) {
  if (kind === 'video') {
    return [...videoReferences()].sort((x, y) => industryScore(y.industry, industry) - industryScore(x.industry, industry));
  }
  if (kind === 'image') {
    return [...imageReferences()].sort((x, y) => industryScore(y.industry, industry) - industryScore(x.industry, industry));
  }
  return [...pageReferences()].sort((x, y) => industryScore(y.industry, industry) - industryScore(x.industry, industry));
}

/**
 * The list the agent chooses from. Deliberately terse: id, what it is, how it is shaped.
 * Reading this must be enough to pick — that is the whole point of storing measurements.
 */
export function referenceMenu(kind: ReferenceKind, industry?: string): string {
  const refs = referencesFor(kind, industry);
  if (!refs.length) return `No ${kind} references banked yet.`;
  return refs
    .map((r) => {
      if (r.kind === 'video') {
        const m = r.measured;
        return `- ${r.id} — "${r.title}" [${r.industry || 'any'}] ${m.orientation} ${m.aspect}, ${m.durationSec.toFixed(1)}s, ${m.shots.length} shot(s) averaging ${m.avgShotSec ?? m.durationSec}s, ${m.cutCount} hard cut(s). ${r.summary}`;
      }
      return `- ${r.id} — "${r.title}" [${r.industry || 'any'}]. ${r.summary}`;
    })
    .join('\n');
}

/** Everything the agent gets once it has chosen: what it is, how it is built, where to look. */
export function referenceBrief(reference: VideoReference | ImageReference | PageReference): string {
  if (reference.kind === 'video') {
    const m = reference.measured;
    return [
      `REFERENCE: ${reference.id} — ${reference.title}`,
      `It is ${m.aspect} ${m.orientation}, ${m.durationSec.toFixed(2)}s at ${m.fps}fps, ${m.shots.length} shot(s) of ${m.shots.map((s) => `${s.toFixed(2)}s`).join(', ')}${m.cutCount === 0 ? ' (no hard cuts — it advances by dissolve)' : ''}.`,
      `Audio: ${m.audioCodec || 'none'}${m.audioChannels ? ` ${m.audioChannels}ch` : ''} at ${m.loudness.meanDb ?? '?'} dB mean.`,
      `Watch it: ${reference.assets.proxyUrl}`,
      `Whole film at a glance: ${reference.assets.sheetUrl}`,
      `How it is built: ${reference.summary}`,
      '',
      'Rebuild it this closely: same aspect, same length band, same shot count and shot durations, same text rhythm.',
      'Extract the frames you need with ffmpeg, rebuild the layers you can (text, cards, captions in HyperFrames),',
      'and place the tenant\'s own material where the reference has its footage. Then compare your render against',
      'the reference frame by frame (`npx hyperframes diff`) and fix what it names before delivering.',
    ].join('\n');
  }
  if (reference.kind === 'image') {
    return [
      `REFERENCE: ${reference.id} — ${reference.title}`,
      `Look at it: ${reference.assets.url}`,
      `How it is built: ${reference.summary}`,
      '',
      'Recreate this composition with the tenant\'s product and brand: same layout, same hierarchy, same',
      'light and framing. Use the reference as the structural input to the image model and swap in the',
      'tenant\'s own facts, product and colours.',
    ].join('\n');
  }
  return [
    `REFERENCE: ${reference.id} — ${reference.title}`,
    `Desktop look: ${reference.assets.desktopUrl}${reference.assets.mobileUrl ? `\nMobile look: ${reference.assets.mobileUrl}` : ''}`,
    `How it is built: ${reference.summary}`,
    '',
    'Rebuild the same structure and rhythm for the tenant, then screenshot your page at 1280 and 390 and',
    'compare it against the reference before delivering.',
  ].join('\n');
}

export function findReference(kind: ReferenceKind, id: string) {
  return referencesFor(kind).find((r) => r.id === id) ?? null;
}
