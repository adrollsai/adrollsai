/**
 * The `image` skill's PROMPT BUILDER. Pure: no I/O, no env, no clock, no random.
 *
 * THE DECISION THIS FILE ENCODES
 * One call produces one FINISHED image. The prompt below asks for the complete
 * designed poster — its hero visual AND its typography — in a single render.
 * The old shape (generate a bare picture, then draw HTML/CSS design elements on
 * top of it with canvas/sharp/SVG) is banned: it produced a visible composited
 * seam, type that did not belong to the picture, and text the model never saw.
 * So nothing here ever asks a model for "a background", for negative space, or
 * for a place to put type later. `TYPOGRAPHY_CLAUSE` is the line that closes
 * that door, and `npm run verify:image-skill` asserts it is in every prompt.
 *
 * WHY THE CLAIM SCAN EXISTS
 * An image model will happily invent "₹1.2 Cr" because a poster usually has a
 * price on it. `findUnverifiedClaims` catches a price, a percentage or a phone
 * number that appears in the brief but not in the supplied facts, and
 * `buildImagePrompt` refuses rather than shipping an invented number to a
 * customer. Over-cautious is the correct failure mode here.
 */

/** The aspect ratios this app actually offers for an image (see `components/agent/CreatePanel.tsx`). */
export const IMAGE_ASPECT_RATIOS = ['3:4', '1:1', '9:16', '16:9'] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

/** How each offered ratio is described to the model. Pixels are what the provider returns. */
export const FRAME_BY_RATIO: Readonly<Record<ImageAspectRatio, string>> = {
  '3:4': 'a 3:4 portrait frame, 1024x1365 — the feed poster',
  '1:1': 'a 1:1 square frame, 1024x1024 — the grid tile',
  '9:16': 'a 9:16 vertical frame, 1024x1820 — the story and reel cover',
  '16:9': 'a 16:9 landscape frame, 1456x816 — the link-ad banner',
};

export class ImagePromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePromptError';
  }
}

export class ImageAspectError extends ImagePromptError {
  readonly offered: readonly string[];

  constructor(value: unknown) {
    const offered = IMAGE_ASPECT_RATIOS.join(', ');
    super(
      `Aspect ratio ${JSON.stringify(value)} is not one this app offers. ` +
        `Use one of: ${offered}. (4:5 is not a provider enum — ask for 3:4 and crop.)`,
    );
    this.name = 'ImageAspectError';
    this.offered = IMAGE_ASPECT_RATIOS;
  }
}

export class InventedFactError extends ImagePromptError {
  readonly claims: string[];

  constructor(claims: string[]) {
    super(
      `Refusing to build this prompt: the brief states ${claims.length} number(s) that are not in the ` +
        `supplied facts — ${claims.join(', ')}. An image model must never be handed a price, a discount or ` +
        'a phone number that nobody verified. Add them to `facts`, or take them out of the brief.',
    );
    this.name = 'InventedFactError';
    this.claims = claims;
  }
}

export function isImageAspectRatio(value: unknown): value is ImageAspectRatio {
  return typeof value === 'string' && (IMAGE_ASPECT_RATIOS as readonly string[]).includes(value);
}

/** Validate an aspect ratio, or explain exactly which ones are on offer. */
export function assertImageAspectRatio(value: unknown): ImageAspectRatio {
  if (isImageAspectRatio(value)) return value;
  throw new ImageAspectError(value);
}

/** The frame sentence for one ratio. Throws for anything the app does not offer. */
export function frameFor(ratio: string): string {
  return FRAME_BY_RATIO[assertImageAspectRatio(ratio)];
}

/**
 * The one sentence that makes this a single-call design rather than a picture
 * with room left for a later overlay. Every emitted prompt contains it verbatim.
 */
export const TYPOGRAPHY_CLAUSE =
  'Set the typography inside this one image: render the headline, the supporting line and every label ' +
  'as real, crisp, correctly spelled type that is part of the artwork itself — the type is generated ' +
  'with the picture in the same pass, never added afterwards by a second design step.';

/**
 * Phrasing that belongs to the banned pipeline: it asks for a bare picture and
 * defers the design to a later overlay. A brief that carries it is rewritten
 * before it reaches a model, so the instruction cannot leak back in.
 */
const BANNED_BRIEF_PATTERNS: readonly { re: RegExp; replacement: string }[] = [
  {
    re: /\b(leave|keep|preserve)\s+(me\s+)?(a\s+|some\s+|enough\s+)?(blank\s+space|empty\s+space|negative\s+space|space\s+for\s+(text|copy|the\s+headline|a\s+logo))\b/gi,
    replacement: 'compose the full design including its type',
  },
  {
    re: /\bno\s+(text|copy|typography|words|labels)\s*(overlays?|on\s+it|in\s+the\s+image)?\b/gi,
    replacement: 'design the typography into the image',
  },
  {
    re: /\bwithout\s+(any\s+)?(text|copy|typography|words)\b/gi,
    replacement: 'with its typography designed in',
  },
  { re: /\b(blank|empty|plain|clean)\s+background\b/gi, replacement: 'a fully designed composition' },
  { re: /\bbare\s+background\b/gi, replacement: 'finished design' },
  { re: /\bbackground\s+(image|only|plate)\b/gi, replacement: 'complete designed image' },
  // Final sweep for the reserved vocabulary itself: after this pass the prompt
  // cannot contain the words the banned pipeline was built on, whatever the
  // caller wrote in the brief.
  { re: /\b(negative|blank|empty)\s+space\b/gi, replacement: 'balanced composition' },
  { re: /\bleave\s+room\b/gi, replacement: 'compose' },
  { re: /\bbackgrounds?\b/gi, replacement: 'surroundings' },
];

/** What a brief looks like after the banned-pipeline phrasing has been removed. */
export function scrubBrief(brief: string): string {
  let text = String(brief ?? '').replace(/\s+/g, ' ').trim();
  for (const { re, replacement } of BANNED_BRIEF_PATTERNS) {
    text = text.replace(re, replacement);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Every banned phrase still present in a string — the check the verify script runs
 * over every emitted prompt. Deliberately literal: the plain word "background" is
 * in the list, because a prompt that says it at all is still describing the banned
 * shape (a picture that a later step draws on).
 */
const BANNED_LITERALS: readonly string[] = [
  'background',
  'blank space',
  'empty space',
  'negative space',
  'space for text',
  'space for the headline',
  'space for a logo',
  'room for text',
  'leave room',
  'no text overlay',
  'without text',
  'without any text',
];

export function bannedPhrasingIn(text: string): string[] {
  const lower = String(text ?? '').toLowerCase();
  return BANNED_LITERALS.filter((literal) => lower.includes(literal));
}

// ────────────────────────────────────────────────────────────────────────────
// Facts
// ────────────────────────────────────────────────────────────────────────────

export type ImageFacts = Record<string, unknown> | null | undefined;

/** Facts as prompt lines. Blank values are dropped rather than rendered as "undefined". */
export function factsBlock(facts: ImageFacts): string {
  if (!facts) return '';
  const lines = Object.entries(facts)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `- ${key.replace(/_/g, ' ')}: ${String(value).trim()}`);
  return lines.join('\n');
}

/** The facts as plain searchable text, for the claim scan. */
function factsText(facts: ImageFacts): string {
  if (!facts) return '';
  return Object.entries(facts)
    .map(([key, value]) => `${key.replace(/_/g, ' ')} ${String(value ?? '')}`)
    .join(' ')
    .toLowerCase();
}

/**
 * Number-shaped claims: money, percentages and telephone numbers.
 *
 * These are the three an image model fabricates most often on a poster, and the
 * three a customer would be held to. A house number or "2BHK" is deliberately
 * NOT a claim — it is part of the description and gating on it would refuse
 * almost every real brief.
 */
const CLAIM_PATTERNS: readonly RegExp[] = [
  /(?:₹|rs\.?|inr|\$|usd|aed|€|£)\s?[\d,.]+(?:\s?(?:cr|crore|lakh|lac|lacs|k|m|mn|million|thousand))?/gi,
  /\b\d[\d,.]*\s?%\s?(?:off|discount|down|apy|interest|returns?)?/gi,
  /\b\d{10,}\b/g,
];

/** Normalise one claim so "₹1.2 Cr" and "₹1.2CR" compare equal. */
function normaliseClaim(claim: string): string {
  return claim.toLowerCase().replace(/[\s,]/g, '').replace(/\.$/, '');
}

/**
 * Claims stated in `brief` that `facts` does not support.
 *
 * Empty means the brief is safe to render. A non-empty list is a refusal: the
 * caller must move those numbers into `facts` (having verified them) or drop
 * them from the brief.
 */
export function findUnverifiedClaims(brief: string, facts: ImageFacts): string[] {
  const briefText = String(brief ?? '');
  const supported = normaliseClaim(factsText(facts));
  const found: string[] = [];

  for (const pattern of CLAIM_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const match of briefText.matchAll(re)) {
      const raw = match[0].trim();
      if (!raw) continue;
      const needle = normaliseClaim(raw);
      // The digits alone must appear in the facts; a currency symbol is presentation.
      const digits = needle.replace(/[^\d.]/g, '');
      const ok = supported.includes(needle) || (digits.length > 0 && supported.includes(digits));
      if (!ok && !found.includes(raw)) found.push(raw);
    }
  }

  return found;
}

/** Throws `InventedFactError` when the brief asserts something the facts do not support. */
export function assertNoInventedFacts(brief: string, facts: ImageFacts): void {
  const claims = findUnverifiedClaims(brief, facts);
  if (claims.length > 0) throw new InventedFactError(claims);
}

// ────────────────────────────────────────────────────────────────────────────
// The prompt
// ────────────────────────────────────────────────────────────────────────────

export interface ImagePromptInput {
  /** What the image is for, in the business's own words. */
  brief: string;
  /** Verified facts only. Anything absent from here must not appear in the image. */
  facts?: ImageFacts;
  /** Reference image URLs. Non-empty routes the call to the image-edit model. */
  referenceUrls?: readonly string[];
  /** One of `IMAGE_ASPECT_RATIOS`. */
  aspectRatio: string;
}

/** The non-negotiable closing rules. Kept as data so a test can assert each one. */
export const PROMPT_RULES: readonly string[] = [
  'Photorealistic commercial photography and real graphic craft — never a flat vector, a wireframe or a mock-up of a poster.',
  'One clear focal point, generous margins, and type that stays legible at thumbnail size on a phone.',
  'Every word, number, price, date, name and phone number on the image must come from the brief or the verified facts above. Invent nothing.',
  'Never print the literal words "logo", "headline", "your text here", "placeholder" or "sample" — those are layout notes, not copy.',
  'No watermarks, no stock-photo borders, no collage of several pictures, no mobile-UI chrome.',
];

/**
 * Build the single prompt that produces one finished image.
 *
 * Deterministic: the same input yields the same string, which is what makes the
 * R2 key (derived from this prompt) mean something across a retry.
 */
export function buildImagePrompt(input: ImagePromptInput): string {
  const ratio = assertImageAspectRatio(input.aspectRatio);
  const frame = FRAME_BY_RATIO[ratio];
  const brief = scrubBrief(input.brief);

  if (!brief) throw new ImagePromptError('A brief is required: say what the image is for.');

  // Refuse rather than render an invented price. Checked AFTER scrubbing so the
  // scrub cannot hide a number, and on the raw brief too, so the error names what
  // the caller actually wrote.
  assertNoInventedFacts(String(input.brief ?? ''), input.facts);

  const references = (input.referenceUrls ?? [])
    .map((url) => String(url ?? '').trim())
    .filter((url) => /^https?:\/\//i.test(url));

  const facts = factsBlock(input.facts);
  const sections: string[] = [];

  sections.push(
    `Create ONE finished marketing image, delivered exactly as generated: a complete, designed ` +
      `advertisement in ${frame}. The picture and its layout are produced together in this single pass; ` +
      'there is no separate design layer, no second compositing step and nothing applied to it afterwards.',
  );

  sections.push(`BRIEF: ${brief}`);

  if (facts) {
    sections.push(
      `VERIFIED FACTS — the only facts allowed to appear anywhere in the image:\n${facts}`,
    );
  } else {
    sections.push(
      'NO FACTS WERE SUPPLIED. Make no numeric, price, date, discount or contact claim of any kind. ' +
        'Set type that is honest without them.',
    );
  }

  if (references.length > 0) {
    const list = references.map((url, i) => `  ${i + 1}. ${url}`).join('\n');
    sections.push(
      `REFERENCE IMAGES (${references.length}) are the real subject, supplied by the business:\n${list}\n` +
        'Reproduce the subject of the first reference faithfully — same building, product, person, ' +
        'packaging and proportions. Do not substitute a different subject, and do not repaint it into ' +
        'something more aspirational than it is. Compose the finished design around that real subject.',
    );
  } else {
    sections.push(
      'No reference image was supplied. Depict only what the brief describes; invent no brand, no ' +
        'building, no person and no product that the brief did not name.',
    );
  }

  sections.push(`THE DESIGN — all of it inside this one image:\n${TYPOGRAPHY_CLAUSE}`);

  sections.push(`RULES:\n${PROMPT_RULES.map((rule) => `- ${rule}`).join('\n')}`);

  return sections.join('\n\n');
}

/**
 * The prompt for a caller that must not be refused (an internal retry of a plan
 * that already passed the claim scan). Identical to `buildImagePrompt`.
 */
export function rebuildImagePrompt(input: ImagePromptInput): string {
  return buildImagePrompt(input);
}
