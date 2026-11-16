/**
 * Find real reference creatives on the open web, and hand the agent URLs it can actually use.
 *
 * WHY THIS EXISTS
 * The built-in library is 35 proven ad designs — useful, but the same 35 for every tenant and every
 * brief. An agent making a cinematography ad for a Chandigarh film school should be able to go and look
 * at what that kind of ad actually looks like right now, pick the one that fits, and say why.
 *
 * THE TWO THINGS THAT MAKE THIS SAFE RATHER THAN SKETCHY
 *
 *   1. LICENSED SOURCES, NOT SCRAPING. Results come from Openverse, which indexes CC0 / public-domain /
 *      CC-BY media and returns licence + creator + source page for every item. That is the difference
 *      between "I found a picture" and "I found a picture I am allowed to use, and here is who to credit".
 *      Deliberately not scraping Meta's Ad Library or Google Images: those have no licence metadata, and
 *      the Ad Library API is scoped to political ads, so a crawler there would be a ToS problem with no
 *      upside.
 *
 *   2. PERSISTED, NOT HOTLINKED. Generators need a URL they can fetch. Random internet URLs rot, block
 *      hotlinking, or expire between the search and the generation call — so each accepted reference is
 *      downloaded once and re-uploaded to our own R2. The agent then passes a URL that cannot 404.
 *
 * A reference is a STYLE GUIDE. It is never the client's own asset, and it must never be presented as
 * theirs — that rule already lives in the prompt and this tool's output repeats it.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadBufferToR2 } from '@/lib/agent/sandbox';

/** Licences that need no attribution, and the ones that do. Commercial use is fine for all of these. */
const LICENCE_NO_ATTRIBUTION = ['cc0', 'pdm'];
const LICENCE_ATTRIBUTION = ['by', 'by-sa'];

interface Candidate {
  title: string;
  url: string;
  landingUrl: string | null;
  licence: string;
  licenceVersion: string | null;
  creator: string | null;
  width: number | null;
  height: number | null;
}

function normaliseCandidate(raw: any): Candidate | null {
  const url = String(raw?.url ?? raw?.thumbnail ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const licence = String(raw?.license ?? raw?.licence ?? '').toLowerCase().trim();
  return {
    title: String(raw?.title ?? 'Reference').trim().slice(0, 120) || 'Reference',
    url,
    landingUrl: raw?.foreign_landing_url ? String(raw.foreign_landing_url) : null,
    licence: licence || 'unknown',
    licenceVersion: raw?.license_version ? String(raw.license_version) : null,
    creator: raw?.creator ? String(raw.creator).slice(0, 80) : null,
    width: Number.isFinite(Number(raw?.width)) ? Number(raw.width) : null,
    height: Number.isFinite(Number(raw?.height)) ? Number(raw.height) : null,
  };
}

/** Words too common to help a keyword search, and too short to match anything useful. */
const QUERY_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'under', 'about', 'their',
  'your', 'our', 'its', 'his', 'her', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but',
  'make', 'making', 'want', 'need', 'like', 'good', 'best', 'some', 'any', 'new', 'one', 'two',
  'ad', 'ads', 'image', 'images', 'photo', 'picture', 'creative', 'reference', 'style',
]);

/**
 * Progressively simpler versions of a search query.
 *
 * PURE, and necessary rather than clever: Openverse ANDs every term, so a natural-language brief —
 * "cinematographer filming on rooftop at sunset" — returns ZERO results, while "cinematographer"
 * returns 240. Measured live: the six-word query found nothing and the one-word query found plenty.
 * So try the brief as written, then the most useful three words, then pairs, then single keywords
 * longest-first. A short, specific query is how this index is meant to be searched.
 */
export function queryLadders(query: string): string[] {
  const raw = String(query || '').trim();
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const useful = words.filter((w) => w.length > 2 && !QUERY_STOP_WORDS.has(w));

  const out: string[] = [];
  const push = (candidate: string) => {
    const text = String(candidate || '').trim().replace(/\s+/g, ' ');
    if (text && !out.includes(text)) out.push(text);
  };

  push(raw);
  if (useful.length > 3) push(useful.slice(0, 3).join(' '));
  if (useful.length > 2) push(useful.slice(-3).join(' '));
  if (useful.length > 1) push(useful.slice(0, 2).join(' '));
  // Single keywords ONLY when the brief was short. For a real multi-word brief, narrowing to one
  // generic word matches almost anything and returns a reference unrelated to the request — and an
  // irrelevant reference is worse than none, because the agent will faithfully copy its look. Measured:
  // with the single-word rung, a deliberately nonsensical query still "found" three images.
  if (useful.length <= 2) {
    for (const word of [...useful].sort((a, b) => b.length - a.length)) push(word);
  }

  return out.slice(0, 8);
}

/**
 * Openverse search. Licence-filtered FIRST, because a beautiful image the tenant cannot legally use is
 * worse than a plain one they can.
 */
async function searchOpenverse(query: string, limit: number): Promise<Candidate[]> {
  const build = (terms: string, licences: string[]) => {
    const params = new URLSearchParams({ q: terms, page_size: String(Math.max(limit, 4)) });
    for (const l of licences) params.append('license', l);
    return `https://api.openverse.org/v1/images/?${params.toString()}`;
  };

  const attempt = async (terms: string, licences: string[]): Promise<Candidate[]> => {
    try {
      const res = await fetch(build(terms, licences), {
        headers: { 'User-Agent': 'nobogent-reference-search' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const body: any = await res.json().catch(() => ({}));
      return (body?.results ?? []).map(normaliseCandidate).filter(Boolean) as Candidate[];
    } catch {
      return [];
    }
  };

  const collected: Candidate[] = [];
  const seen = new Set<string>();
  const add = (list: Candidate[]) => {
    for (const c of list) {
      if (collected.length >= limit) return;
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      collected.push(c);
    }
  };

  // Walk the ladder, licence-clean first at every rung: CC0 and public domain need no credit at all,
  // then the attribution licences, which are still fine commercially as long as we credit.
  for (const terms of queryLadders(query)) {
    if (collected.length >= limit) break;
    add(await attempt(terms, LICENCE_NO_ATTRIBUTION));
    if (collected.length >= limit) break;
    add(await attempt(terms, [...LICENCE_NO_ATTRIBUTION, ...LICENCE_ATTRIBUTION]));
  }

  return collected.slice(0, limit);
}

/**
 * Download and re-host one candidate. Returns null if it cannot be fetched or is not an image — a
 * broken candidate must not fail the whole search, because one of the others is usually good.
 */
async function persist(candidate: Candidate, userId: string): Promise<{ url: string; bytes: number } | null> {
  try {
    const res = await fetch(candidate.url, {
      headers: { 'User-Agent': 'nobogent-reference-search' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!/^image\//i.test(type)) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 8_000) return null; // thumbnails and error pages are not references
    if (buffer.length > 12 * 1024 * 1024) return null;

    const ext = /png/i.test(type) ? 'png' : /webp/i.test(type) ? 'webp' : 'jpg';
    const safeName = `${Date.now()}_ref_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const url = await uploadBufferToR2(buffer, `reference-search/${safeName}`, userId);
    if (!url || !/^https?:\/\//i.test(url)) return null;
    return { url, bytes: buffer.length };
  } catch {
    return null;
  }
}

export function createReferenceSearchTools(supabaseClient: SupabaseClient, userId: string) {
  return {
    /**
     * Search the web for licensed reference creatives that fit the brief.
     *
     * `kind: 'video'` does not crawl: video references come from the 24fps motion-graphics library and
     * from web research, both of which are already wired. Saying so plainly beats pretending to search
     * a video index that does not exist here.
     */
    find_reference_creatives: tool({
      description:
        'Search the open web for REAL, commercially-usable reference creatives that fit a specific brief ' +
        '(e.g. "cinematic film school ad", "dark moody product shot", "festive gold diwali greeting"). ' +
        'Returns reference image URLs already re-hosted on our own storage, each with its licence and ' +
        'creator, so you can pass them straight to generate_ai_image as referenceImageUrls or to ' +
        'generate_grok_video as imageUrls. ' +
        'A reference is a STYLE GUIDE — never an asset you deliver, and never to be described as the ' +
        'owner\'s own. Say which reference you followed and what you took from it (layout, palette, type ' +
        'treatment, lighting). Prefer this over inventing a look from nothing when the brief is thin. ' +
        'For VIDEO references this returns guidance instead of results: use search_24fps_motion_graphics ' +
        'and web research for moving references.',
      inputSchema: z.object({
        query: z
          .string()
          .min(3)
          .describe(
            'What the reference should look like, in the words a designer would search: subject, mood, ' +
              'lighting, composition. e.g. "cinematographer filming on rooftop at sunset"',
          ),
        kind: z
          .enum(['image', 'video'])
          .default('image')
          .describe('image for still references (avoids avatars and unintended people), video for guidance only'),
        limit: z.number().default(4).describe('How many references to return (1-6)'),
      }),
      execute: async ({ query, kind, limit }) => {
        const wanted = Math.min(Math.max(Math.round(Number(limit) || 4), 1), 6);

        if (kind === 'video') {
          return {
            success: true,
            kind: 'video',
            references: [],
            guidance:
              'Video references are not crawled. Use search_24fps_motion_graphics for real motion-graphic ' +
              'clips and presets, and research the format on the web, then name the reference you followed. ' +
              'For a still frame to hold up as a visual anchor, call this tool with kind "image".',
          };
        }

        try {
          const candidates = await searchOpenverse(query, wanted);
          if (!candidates.length) {
            return {
              success: false,
              error:
                `No licensed reference found for "${query}". That is an answer, not a failure: say you could ` +
                'not find a reference and design from the brand profile and the brief instead. Do not invent a ' +
                'reference you did not see.',
              references: [],
            };
          }

          const persisted: any[] = [];
          for (const candidate of candidates) {
            if (persisted.length >= wanted) break;
            const stored = await persist(candidate, userId);
            if (!stored) continue;
            const needsCredit = !LICENCE_NO_ATTRIBUTION.includes(candidate.licence);
            persisted.push({
              url: stored.url,
              sourceUrl: candidate.landingUrl ?? candidate.url,
              title: candidate.title,
              licence: candidate.licence,
              licenceVersion: candidate.licenceVersion,
              creator: candidate.creator,
              needsAttribution: needsCredit,
              credit: needsCredit
                ? `${candidate.title}${candidate.creator ? ` by ${candidate.creator}` : ''} (${candidate.licence.toUpperCase()})`
                : null,
              dimensions: candidate.width && candidate.height ? `${candidate.width}x${candidate.height}` : null,
            });
          }

          if (!persisted.length) {
            return {
              success: false,
              error:
                'Found candidates but none could be downloaded and re-hosted, so there is no URL to hand a ' +
                'generator. Design from the brief and the brand profile instead.',
              references: [],
            };
          }

          return {
            success: true,
            kind: 'image',
            query,
            count: persisted.length,
            references: persisted,
            note:
              'These are STYLE REFERENCES, not the owner\'s assets and not deliverables. Pass a url to ' +
              'generate_ai_image (referenceImageUrls) or generate_grok_video (imageUrls) to borrow the look, ' +
              'then tell the owner which reference you followed and what you took from it. Where ' +
              'needsAttribution is true, credit the creator if the reference itself is ever shown.',
          };
        } catch (err: any) {
          return { success: false, error: String(err?.message || err), references: [] };
        }
      },
    }),
  };
}
