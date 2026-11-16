/**
 * Only put an image on a page if it belongs there.
 *
 * The defect this fixes: filling a page gallery from the account's asset library put a Diwali "GRAND OPENING 50% OFF"
 * poster onto the Nobogent page. Filtering by filename cannot catch that — the files are named
 * `1794827361451_nobogent-ad.png` — and a gallery of somebody else's offer is worse than no gallery, because it
 * advertises a different business on the client's own page.
 *
 * The only thing that can tell you what an image shows is looking at it. So each candidate is shown to a vision model
 * with a single question about THIS page, and only images it accepts are used. The inspector is injected so this
 * stays testable without spending a generation.
 */

export interface ImageCandidate {
  url: string;
  /** Why the caller offered it, if it knows ("asset library", "owner supplied", "generated for this offer"). */
  origin?: string;
}

export interface RelevanceResult {
  keep: string[];
  rejected: Array<{ url: string; why: string }>;
  /** True when the check could not run at all, so the caller knows the images were passed unverified. */
  unchecked: boolean;
}

export type ImageInspector = (url: string, prompt: string) => Promise<string>;

/**
 * The question asked about every candidate image.
 *
 * Deliberately binary and deliberately about the OFFER: "is this a photograph that could appear on a page selling X"
 * is answerable, whereas "is this good" is not. It also rules out the specific things that made the bad gallery bad —
 * another business's poster, a festival greeting, a logo, a screenshot of text.
 */
export function relevancePrompt(brief: { productName: string; businessName: string; offer?: string }): string {
  return [
    `You are checking a photograph before it is placed on a marketing page.`,
    `The page sells: "${brief.productName}" from ${brief.businessName}${brief.offer ? `, offered as "${brief.offer}"` : ''}.`,
    '',
    'Answer NO if the image is any of these:',
    '- a poster, flyer or creative advertising something else (another business, a discount, a festival greeting)',
    '- text-heavy artwork, a logo, an icon, or a screenshot of a document',
    '- a stock image of people that has nothing to do with the product',
    '',
    'Answer YES only if it is a photograph that could credibly appear on this page as real imagery of the work, the',
    'place, the people or the product.',
    '',
    'Reply with one word: YES or NO. Then, on the same line after a dash, at most ten words saying what the image shows.',
  ].join('\n');
}

/** Accept an inspector answer as a decision. Anything that is not a clear YES is a no: silence must not imply approval. */
export function readVerdict(answer: string): { relevant: boolean; note: string } {
  const text = String(answer ?? '').trim();
  const head = text.slice(0, 40).toUpperCase();
  const relevant = /^YES\b/.test(head) || /^\bYES\b/.test(head);
  const note = (text.split(/[-—:]/).slice(1).join(' ').trim() || text.slice(0, 80)).replace(/\s+/g, ' ').trim();
  return { relevant, note };
}

/**
 * Show every candidate to the inspector and keep the ones it accepts, up to `limit`.
 *
 * Failure is not permission: if the inspector throws for a candidate, that candidate is REJECTED with the reason,
 * because "we could not check" and "it is fine" are different statements and the page is public.
 */
export async function filterRelevantImages(opts: {
  candidates: ImageCandidate[];
  brief: { productName: string; businessName: string; offer?: string };
  inspect: ImageInspector;
  limit?: number;
}): Promise<RelevanceResult> {
  const keep: string[] = [];
  const rejected: Array<{ url: string; why: string }> = [];
  const limit = opts.limit ?? 4;
  const prompt = relevancePrompt(opts.brief);

  for (const candidate of opts.candidates) {
    if (keep.length >= limit) break;
    try {
      const answer = await opts.inspect(candidate.url, prompt);
      const { relevant, note } = readVerdict(answer);
      if (relevant) keep.push(candidate.url);
      else rejected.push({ url: candidate.url, why: note || 'not relevant to this page' });
    } catch (err: any) {
      rejected.push({ url: candidate.url, why: `could not be checked: ${err?.message ?? err}` });
    }
  }

  return { keep, rejected, unchecked: keep.length === 0 && rejected.length === opts.candidates.length && opts.candidates.length > 0 };
}
