/**
 * The default ad-creative system: turn a brief into a prompt that makes a high-converting Meta ad.
 *
 * WHY THIS EXISTS
 * When the owner passes a reference, the reference decides the visual language and we follow it. When they do
 * not, the agent used to improvise a prompt from the brief — which is how you get a pretty image that says
 * nothing, or a beautiful poster with no offer on it. A reference search can fill that gap, but a search can
 * also come back empty, and a creative must not get worse because a search engine was busy.
 *
 * So the floor is here, in code rather than in a paragraph: an offer-led ad is not a picture of the product,
 * it is a message with a hierarchy. This module knows the hierarchy, picks an angle that fits the offer, and
 * emits the exact prompt and the exact layout to build.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * No invented performance numbers. This file contains craft that is checkable — one message, one call to
 * action, offer stated in figures, type legible at the size it will actually be seen, contrast measured with
 * WCAG maths, safe margins that survive placement cropping. It contains no CTR claims, because I cannot
 * verify one and a fabricated statistic in a client's ad is worse than no statistic.
 *
 * EVERY CLAIM MUST COME FROM THE BUSINESS. Slots with no supplied fact come back as `[NEEDS: …]` rather than
 * being filled with something plausible. An ad that invents a placement rate is a legal problem, not a
 * creative one.
 */

export type AdFormat = '1:1' | '4:5' | '9:16' | '16:9';

export interface AdFormatSpec {
  label: string;
  width: number;
  height: number;
  /** Where the format is actually seen, which is what decides the safe area. */
  placements: string;
  /** Fraction of the short edge kept clear on every side, for placement crops and platform chrome. */
  safeMargin: number;
  /** Headline cap height as a fraction of the frame height. */
  headlineScale: number;
  /** Words that still read on a phone at this size. Beyond this it stops being a headline. */
  maxHeadlineWords: number;
  maxSubheadWords: number;
}

export const AD_FORMATS: Record<AdFormat, AdFormatSpec> = {
  '1:1': {
    label: '1080 × 1080 — square',
    width: 1080,
    height: 1080,
    placements: 'Facebook and Instagram feed',
    safeMargin: 0.06,
    headlineScale: 0.085,
    maxHeadlineWords: 7,
    maxSubheadWords: 12,
  },
  '4:5': {
    label: '1080 × 1350 — portrait feed',
    width: 1080,
    height: 1350,
    placements: 'Instagram and Facebook feed (tallest feed unit, least cropped)',
    safeMargin: 0.06,
    headlineScale: 0.075,
    maxHeadlineWords: 8,
    maxSubheadWords: 14,
  },
  '9:16': {
    label: '1080 × 1920 — vertical',
    width: 1080,
    height: 1920,
    placements: 'Reels, Stories, and the feed',
    safeMargin: 0.1,
    headlineScale: 0.055,
    maxHeadlineWords: 7,
    maxSubheadWords: 10,
  },
  '16:9': {
    label: '1920 × 1080 — landscape',
    width: 1920,
    height: 1080,
    placements: 'In-stream, right column, YouTube',
    safeMargin: 0.05,
    headlineScale: 0.11,
    maxHeadlineWords: 6,
    maxSubheadWords: 12,
  },
};

/** An angle is the argument the ad makes. One ad makes exactly one. */
export interface AdAngle {
  id: string;
  name: string;
  /** The argument, in one sentence, so the agent can say why it chose it. */
  argument: string;
  /** What must be true for this angle to be honest. Missing facts become [NEEDS: …]. */
  requires: Array<'offer' | 'price' | 'deadline' | 'seats' | 'proof' | 'authority' | 'place' | 'outcome'>;
  /** Industry keywords this angle suits. Scoring only — never a hard gate. */
  suits: string[];
  /** Headline shapes. {slots} are filled from facts, or returned as [NEEDS: slot]. */
  headlines: string[];
  /**
   * Subhead shapes, in preference order. These are CUSTOMER-FACING COPY, never instructions.
   *
   * This distinction was a real bug: the first version put "One line of proof, then the call to action" in this
   * field, and because every string here is quoted into the image prompt as copy, a generated ad shipped with my
   * authoring note written across it. Directions live in `subheadGuidance`, which is never rendered.
   */
  subheads: string[];
  /** Advice for whoever writes the subhead. Not copy — it never reaches the image. */
  subheadGuidance: string;
  /** How the visual should behave. This is what makes the image prompt specific. */
  visual: string;
}

export const AD_ANGLES: AdAngle[] = [
  {
    id: 'offer-first',
    name: 'The offer, stated plainly',
    argument: 'The reason to act today is the price. Lead with the number and make everything else support it.',
    requires: ['offer'],
    suits: ['education', 'course', 'academy', 'coaching', 'retail', 'product', 'clinic', 'salon', 'gym'],
    headlines: [
      '{offer} ON THE {product}',
      '{offer}. {product}. {place}',
      'THE {product} — {offer}',
    ],
    subheads: ['{product} · {place}', '{product}'],
    subheadGuidance: 'One line of proof under the number, then the call to action.',
    visual:
      'The number is the largest element in the frame, set in a heavy condensed sans, isolated on its own ' +
      'band of colour so it reads before anything else. Photography sits behind or beside it, never over it. ' +
      'Everything that is not the price and the product is smaller than both.',
  },
  {
    id: 'scarcity-deadline',
    name: 'A deadline that is real',
    argument: 'A decision now beats a decision later, but only if the limit is true — invented deadlines erode trust.',
    requires: ['deadline'],
    suits: ['education', 'course', 'academy', 'admissions', 'event', 'retail'],
    headlines: [
      '{seats} — {deadline}',
      'ONLY {seats} LEFT FOR {product}',
      '{deadline}: {offer}',
    ],
    subheads: ['ADMISSIONS CLOSE {deadline}', '{product} · {place}', '{product}'],
    subheadGuidance: 'Name the real limit and the date; no countdown theatre.',
    visual:
      'A single date or number held large, with the product in a clean secondary position. Restrained palette: ' +
      'the urgency comes from the type, not from red explosions. No fake countdown graphics.',
  },
  {
    id: 'proof',
    name: 'Someone else already did it',
    argument: 'Show that the outcome is real for a person like the viewer, not just claimed by the business.',
    requires: ['proof'],
    suits: ['education', 'course', 'academy', 'clinic', 'gym', 'service', 'consulting'],
    headlines: [
      '{proof}',
      'FROM {before} TO {after}',
      'THEY DID IT. HERE IS HOW.',
    ],
    subheads: ['{proof}', '{product} · {place}', '{product}'],
    subheadGuidance: 'One concrete result, attributed, with the product named.',
    visual:
      'Documentary framing: a real person, real environment, natural light, no stock-smile energy. Type sits in ' +
      'a quiet corner as a caption rather than a banner. If the business supplied no proof, this angle is not ' +
      'available — pick another instead of inventing a testimonial.',
  },
  {
    id: 'objection',
    name: 'The thing they are worried about',
    argument: 'Name the objection before they do and answer it in the same breath.',
    requires: ['offer'],
    suits: ['education', 'course', 'academy', 'clinic', 'insurance', 'property', 'finance'],
    headlines: [
      'NO {objection}',
      '{objection}? NOT HERE.',
      'WORRIED ABOUT {objection}?',
    ],
    subheads: ['{product} · {place}', '{product}'],
    subheadGuidance: 'Answer the worry with a fact from the business\'s own record.',
    visual:
      'Two-part composition: the worry in small, muted type; the answer in large, high-contrast type. The ' +
      'product appears once, calmly. No aggressive imagery — the reader is anxious, not excited.',
  },
  {
    id: 'transformation',
    name: 'Before and after',
    argument: 'The change is the product. Show both states in one frame so the delta is undeniable.',
    requires: ['outcome'],
    suits: ['gym', 'fitness', 'salon', 'clinic', 'dental', 'interior', 'property', 'renovation'],
    headlines: [
      'BEFORE. AFTER. {product}.',
      'THE DIFFERENCE IS {outcome}',
      '{outcome} — WITHOUT {objection}',
    ],
    subheads: ['{outcome}', '{product} · {place}', '{product}'],
    subheadGuidance: 'One measured change, stated as a number or a span of time.',
    visual:
      'A hard vertical or horizontal split, identical framing and light on both sides so only the change differs. ' +
      'No soft dissolves. Labels small and consistent. Keep the split honest: same angle, same distance.',
  },
  {
    id: 'authority',
    name: 'Why us and not them',
    argument: 'Credentials reduce risk. Lead with the one fact that a competitor cannot copy.',
    requires: ['authority'],
    suits: ['education', 'course', 'academy', 'clinic', 'legal', 'consulting', 'manufacturing'],
    headlines: [
      '{authority}',
      '{authority}. {product}.',
      'TAUGHT BY {authority}',
    ],
    subheads: ['{authority}', '{product} · {place}', '{product}'],
    subheadGuidance: 'The credential, then the product it applies to.',
    visual:
      'Editorial and restrained: generous negative space, one strong portrait or environmental shot, a single ' +
      'tracked-out label. Confidence reads as space, not as decoration.',
  },
  {
    id: 'curiosity',
    name: 'The open loop',
    argument: 'A specific, answerable question stops the scroll — as long as the answer is on the next screen.',
    requires: ['offer'],
    suits: ['education', 'course', 'academy', 'content', 'app', 'saas', 'media'],
    headlines: [
      'THE ONE THING {audience} GET WRONG ABOUT {topic}',
      'WHAT {audience} LEARN IN WEEK ONE',
      'NOBODY TELLS YOU THIS ABOUT {topic}',
    ],
    subheads: ['{product} · {place}', '{product}'],
    subheadGuidance: 'A real answer is promised, so the landing page must deliver it.',
    visual:
      'One hero subject, tight crop, dramatic direction of light, and a headline that occupies the top third. ' +
      'Type over the darkest part of the frame, never over a busy area. The product is implied, not labelled.',
  },
  {
    id: 'local',
    name: 'Right here',
    argument: 'Proximity converts when the alternative is travel or distance.',
    requires: ['place'],
    suits: ['education', 'course', 'academy', 'clinic', 'gym', 'retail', 'property', 'restaurant'],
    headlines: [
      '{product} IN {place}',
      'NOW IN {place}',
      '{offer} — {place}',
    ],
    subheads: ['{product} · {place}', '{offer} · {place}', '{product}'],
    subheadGuidance: 'The place named the way locals name it, plus the contact.',
    visual:
      'A recognisable environment shot with the location legible in the frame, not a generic skyline. Type in a ' +
      'single band with the marker and contact number. Warm, approachable grade.',
  },
];

export interface AdBriefInput {
  /** What is being advertised, in the business's own words. */
  product: string;
  /** The offer as it should appear, e.g. "₹15,000 off the November batch". Optional — many briefs have none. */
  offer?: string;
  /** Audience, e.g. "aspiring cinematographers in Chandigarh". */
  audience?: string;
  /** Town or city the business actually serves. */
  place?: string;
  /** Facts the business supplied. Anything not here becomes [NEEDS: …], never an invention. */
  facts?: Record<string, string | number | null | undefined>;
  format?: AdFormat;
  /** brand colours, as hex. Used for the measured contrast check. */
  brandColor?: string | null;
  /** Call to action. Defaults to a phone call when a contact exists. */
  cta?: 'call' | 'whatsapp' | 'visit' | 'apply' | 'book';
  contact?: string | null;
  businessName?: string;
  industry?: string | null;
  /** Excluded angles, e.g. when the owner rejected one. */
  avoid?: string[];
}

export interface AdCreativeSpec {
  format: AdFormat;
  formatLabel: string;
  angle: { id: string; name: string; argument: string; whyChosen: string };
  headline: string;
  headlineAlternatives: string[];
  subhead: string | null;
  offer: string | null;
  /** Writing advice for the subhead. NOT copy — it is never quoted into the image prompt. */
  direction: string;
  cta: { label: string; placement: string };
  /** The prompt to hand generate_ai_image, or to build as HTML. Complete; no placeholder styling. */
  imagePrompt: string;
  /** The layout to build when the creative is composed in code. */
  layout: {
    canvas: string;
    safeAreaPx: { top: number; right: number; bottom: number; left: number };
    typeScalePx: { headline: number; subhead: number; cta: number };
    hierarchy: string[];
    contrast: { measure: string; required: number; actual: number | null; verdict: string };
    negativeSpace: string;
  };
  /** For reels and stories. Times in seconds from 0. */
  videoBeats: Array<{ from: number; to: number; onScreen: string; shot: string }>;
  /** Facts the ad needs but the business has not supplied. The agent fills these or drops the angle. */
  needs: string[];
  checklist: string[];
}

const CTA_LABELS: Record<'call' | 'whatsapp' | 'visit' | 'apply' | 'book', string> = {
  call: 'CALL NOW',
  whatsapp: 'MESSAGE US',
  visit: 'VISIT US',
  apply: 'APPLY NOW',
  book: 'BOOK A SLOT',
};

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// The contrast maths lives in lib/design/contrast.ts so the page generator measures palettes the same way this
// compiler does. Imported for use here, and re-exported because this module's public surface already had it.
import { contrastRatio } from '@/lib/design/contrast';
export { contrastRatio, relativeLuminance } from '@/lib/design/contrast';

/** Pick the angle whose required facts the business actually supplied, scoring industry fit as a tiebreak. */
export function chooseAngle(input: AdBriefInput): { angle: AdAngle; whyChosen: string } {
  const facts = input.facts || {};
  const has = (key: AdAngle['requires'][number]): boolean => {
    if (key === 'offer') return Boolean(input.offer);
    if (key === 'place') return Boolean(input.place);
    const value = facts[key];
    return value !== undefined && value !== null && String(value).trim().length > 0;
  };

  const industry = `${input.industry || ''} ${input.product} ${input.offer || ''}`.toLowerCase();
  const avoided = new Set((input.avoid || []).map((a) => a.toLowerCase()));

  const scored = AD_ANGLES.filter((angle) => !avoided.has(angle.id) && !avoided.has(angle.name.toLowerCase())).map(
    (angle) => {
      const missing = angle.requires.filter((need) => !has(need));
      const suited = angle.suits.filter((word) => industry.includes(word)).length;
      // A fully supported angle always beats a better-targeted unsupported one: honesty outranks fit.
      const score = (missing.length === 0 ? 100 : 0) + suited;
      return { angle, missing, score };
    },
  );

  scored.sort((a, b) => b.score - a.score || a.missing.length - b.missing.length);
  const best = scored[0];

  if (!best) {
    // Every angle was excluded: fall back to the plainest one rather than shipping nothing.
    return { angle: AD_ANGLES[0], whyChosen: 'Every requested angle was excluded, so the offer-first angle is the safe default.' };
  }

  const why = best.missing.length
    ? `${best.angle.name}: the business supplied ${best.angle.requires.filter(has).join(', ') || 'nothing specific'} ` +
      `and is missing ${best.missing.join(', ')} — those slots are flagged, not invented.`
    : `${best.angle.name}: every fact this angle needs was supplied (${best.angle.requires.join(', ')}), so the ` +
      'argument can be made without inventing anything.';

  return { angle: best.angle, whyChosen: why };
}

/** Fill {slots} from the brief, and flag anything missing instead of inventing it. */
function fill(template: string, input: AdBriefInput, needs: Set<string>): string {
  const facts = input.facts || {};
  const slots: Record<string, string | undefined> = {
    product: input.product,
    offer: input.offer,
    place: input.place,
    audience: input.audience,
    topic: (facts.topic as string) || input.product,
    seats: facts.seats !== undefined ? String(facts.seats) : undefined,
    deadline: facts.deadline !== undefined ? String(facts.deadline) : undefined,
    proof: facts.proof !== undefined ? String(facts.proof) : undefined,
    authority: facts.authority !== undefined ? String(facts.authority) : undefined,
    outcome: facts.outcome !== undefined ? String(facts.outcome) : undefined,
    objection: facts.objection !== undefined ? String(facts.objection) : undefined,
    before: facts.before !== undefined ? String(facts.before) : undefined,
    after: facts.after !== undefined ? String(facts.after) : undefined,
  };

  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = slots[key];
    if (value && String(value).trim()) return String(value).trim().toUpperCase();
    needs.add(key);
    return `[NEEDS: ${key}]`;
  });
}

/** Words too generic to carry a headline. */
const FILLER = new Set(['in', 'the', 'of', 'for', 'on', 'a', 'an', 'and', 'at', 'to', 'with', '&']);

/**
 * The shortest honest version of a product name: drop filler words and keep the last two significant ones.
 *
 * "Diploma in Cinematography" becomes "Diploma Cinematography"; "3 BHK apartments at Green Meadows" becomes
 * "Green Meadows". The head of a name is usually the category (which the image shows anyway); the tail is
 * usually the specific thing, which is what a headline needs.
 */
export function shortenProduct(product: string): string {
  const significant = String(product || '')
    .split(/\s+/)
    .filter((word) => word && !FILLER.has(word.toLowerCase()));
  if (significant.length <= 2) return significant.join(' ');
  return significant.slice(-2).join(' ');
}

/**
 * Choose a headline that FITS the format.
 *
 * A headline that needs 11 words on a 4:5 feed unit is not a headline, it is a paragraph that will be skimmed and
 * lost. So the ladder is: the angle's own templates first, then the same templates with the product shortened,
 * then the offer on its own with the product moved to the subhead. The offer is never cut — it is the reason the
 * ad exists — but the product name is allowed to get shorter, and it always survives somewhere in the frame.
 */
export function pickHeadline(
  angle: AdAngle,
  input: AdBriefInput,
  cap: number,
  needs: Set<string> = new Set<string>(),
): { headline: string; alternatives: string[]; shortenedProduct: boolean; productMovedToSubhead: boolean } {
  const fits = (text: string) => words(text) <= cap;

  let variants = angle.headlines.map((template) => fill(template, input, needs));
  let chosen = variants.find(fits) || null;

  let shortenedProduct = false;
  if (!chosen) {
    const short = shortenProduct(input.product);
    if (short && short !== input.product.trim()) {
      shortenedProduct = true;
      variants = angle.headlines.map((template) => fill(template, { ...input, product: short }, needs));
      chosen = variants.find(fits) || null;
    }
  }

  let productMovedToSubhead = false;
  if (!chosen && input.offer) {
    const offerOnly = String(input.offer).trim().toUpperCase();
    if (fits(offerOnly)) {
      chosen = offerOnly;
      productMovedToSubhead = true;
    }
  }

  const headline = chosen || variants[0];
  return {
    headline,
    alternatives: variants.filter((variant) => variant !== headline).slice(0, 2),
    shortenedProduct,
    productMovedToSubhead,
  };
}

/**
 * Choose a subhead that is real copy, and that says something the headline does not already say.
 *
 * The rule this enforces: every string that reaches the image prompt is quoted as something to RENDER, so it has
 * to be words a customer reads. A template whose slots are not all available produces `[NEEDS: …]`, which is
 * acceptable in the returned `needs` list but not acceptable painted on a poster — so those are skipped, and the
 * plain product line is the floor because `product` is always supplied.
 *
 * The second rule came from looking at a generated ad: the headline read "…DIPLOMA CINEMATOGRAPHY. CHANDIGARH" and
 * the subhead underneath repeated "DIPLOMA IN CINEMATOGRAPHY · CHANDIGARH". Space in a feed unit is the scarcest
 * thing an ad owns, and spending it on a repeat is a wasted element. So a subhead that adds no new word is dropped
 * rather than printed, and the layout falls back to headline + offer + CTA.
 */
export function pickSubhead(angle: AdAngle, input: AdBriefInput, headline: string): string | null {
  const significant = (text: string) =>
    new Set(
      String(text || '')
        .replace(/[^\p{L}\p{N}₹%]+/gu, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2 && !FILLER.has(word.toLowerCase()))
        .map((word) => word.toLowerCase()),
    );

  const headlineWords = significant(headline);
  const addsNothing = (candidate: string) => {
    const words = significant(candidate);
    if (!words.size) return true;
    for (const word of words) if (!headlineWords.has(word)) return false;
    return true;
  };

  for (const template of angle.subheads) {
    const scratch = new Set<string>();
    const filled = fill(template, input, scratch);
    if (scratch.size === 0 && filled.trim() && !addsNothing(filled)) return filled;
  }
  return null;
}

/**
 * Build the whole creative: angle, copy, image prompt, layout, video beats and the checklist to verify against.
 *
 * Deterministic for the same input, which is what makes it testable and what stops the agent from drifting into
 * a different structure on a retry.
 */
export function composeAdCreative(input: AdBriefInput): AdCreativeSpec {
  const format: AdFormat = input.format && AD_FORMATS[input.format] ? input.format : '4:5';
  const spec = AD_FORMATS[format];
  const needs = new Set<string>();
  const { angle, whyChosen } = chooseAngle(input);
  const required = new Set<string>(angle.requires as string[]);

  const picked = pickHeadline(angle, input, spec.maxHeadlineWords, needs);
  const headline = picked.headline;
  const alternatives = picked.alternatives;
  const baseSubhead = pickSubhead(angle, input, headline);
  // When the headline had to shed the product name, the product goes here rather than disappearing — but only if
  // there is a subhead line to put it on, and only if it is not already implied by the headline.
  const subhead =
    baseSubhead && picked.productMovedToSubhead
      ? `${String(input.product).toUpperCase()} · ${baseSubhead}`
      : baseSubhead;

  // Only the slots this angle actually requires are worth flagging; the optional ones are noise.
  const relevantNeeds = [...needs].filter((key) => required.has(key) || key === 'offer' || key === 'product');

  const ctaKind = input.cta || (input.contact ? 'call' : 'visit');
  const ctaLabel = CTA_LABELS[ctaKind] || CTA_LABELS.call;
  const contactLine = input.contact ? ` ${input.contact}` : '';

  const brand = input.brandColor || '#D0E8FF';
  const background = '#0B1220';
  const ratio = contrastRatio(brand, background);

  const headlinePx = Math.round(spec.height * spec.headlineScale);
  const subheadPx = Math.round(headlinePx * 0.34);
  const ctaPx = Math.round(subheadPx * 0.95);
  const marginY = Math.round(spec.height * spec.safeMargin);
  const marginX = Math.round(spec.width * spec.safeMargin);

  const headlineWords = words(headline);
  const tooLong = headlineWords > spec.maxHeadlineWords;

  const messageBlocks = [
    `(1) headline "${headline}" — the largest thing in the frame, set in a heavy condensed sans at roughly ` +
      `${headlinePx}px cap height`,
  ];
  if (subhead) {
    messageBlocks.push(`(2) subhead "${subhead}" at roughly ${subheadPx}px, one weight lighter`);
  }
  messageBlocks.push(
    `(${messageBlocks.length + 1}) the call to action "${ctaLabel}${contactLine}" as a single filled button at ` +
      `roughly ${ctaPx}px, high contrast, bottom third, clear of the safe area`,
  );

  const textElementCount = subhead ? 3 : 2;

  const imagePrompt = [
    `Design a ${spec.width}×${spec.height} ${format} paid social ad for ${input.businessName || 'the business'}.`,
    `THE MESSAGE, in this order: ${messageBlocks.join('; ')}.`,
    `THE ANGLE: ${angle.argument}`,
    `THE VISUAL: ${angle.visual}`,
    `THE SUBJECT: ${input.product}${input.place ? `, in ${input.place}` : ''}. Photographic, real, ` +
      'specific to this business — not a stock scene and not a generic symbol of the category.',
    `COLOUR: background ${background}, accents and type in ${brand} where contrast allows; keep total palette to ` +
      'three values. No gradients-for-the-sake-of-gradients, no lens flares, no drop shadows on body text.',
    `TYPOGRAPHY: one family, two weights. Exactly ${textElementCount} text elements in the whole frame — do not add ` +
      `a tagline, a slogan or secondary copy that was not asked for. ` +
      `Keep every text element inside ${marginX}px of the left and right edge and ${marginY}px of the top and bottom.`,
    `COMPOSITION: leave the ${angle.id === 'curiosity' ? 'top third' : 'lower third'} quiet for the type; ` +
      'put the subject where the eye lands first and the type where it lands second.',
    'RENDER REAL TEXT, spelled exactly as quoted. No gibberish lettering, no lorem, no watermark.',
  ].join('\n');

  const beats =
    format === '9:16'
      ? [
          { from: 0, to: 3, onScreen: headline, shot: 'Hook: the subject already in motion, no logo, no intro. Text lands with the first frame.' },
          { from: 3, to: 8, onScreen: subhead || headline, shot: 'Proof: three fast cuts of the real thing — the place, the people, the work.' },
          { from: 8, to: 12, onScreen: input.offer ? input.offer : headline, shot: 'The offer, held still long enough to read. Music drops to a bed.' },
          { from: 12, to: 15, onScreen: `${ctaLabel}${contactLine}`, shot: 'End card: brand mark, contact, one call to action. Nothing else moves.' },
        ]
      : [];

  const checklist = [
    `One message only: the headline is "${headline}" and nothing competes with it.`,
    `One call to action, and it is "${ctaLabel}".`,
    `Reads at 540px wide (the preview size) — if the subhead is unreadable there, it is unreadable in the feed.`,
    `Headline is ${headlineWords} word(s)${tooLong ? ` — OVER the ${spec.maxHeadlineWords}-word limit for ${format}; cut it` : ', inside the limit'}` +
      `${picked.shortenedProduct ? ' (the product name was shortened to fit; keep it in the subhead)' : ''}` +
      `${picked.productMovedToSubhead ? ' (the product name moved to the subhead so the offer could be the headline)' : ''}.`,
    `Contrast ${ratio === null ? 'could not be measured (brand colour not a hex value)' : `brand-on-background is ${ratio}:1`}` +
      `${ratio !== null && ratio < 4.5 ? ' — BELOW 4.5:1, darken or lighten one of them before building' : ''}.`,
    `No invented claim: ${relevantNeeds.length ? `still needs ${relevantNeeds.join(', ')} from the business` : 'every claim came from supplied facts'}.`,
    `All text inside the ${marginX}/${marginY}px safe area so placement crops cannot clip it.`,
  ];

  return {
    format,
    formatLabel: spec.label,
    angle: { id: angle.id, name: angle.name, argument: angle.argument, whyChosen },
    headline,
    headlineAlternatives: alternatives,
    subhead,
    offer: input.offer || null,
    direction: angle.subheadGuidance,
    cta: { label: `${ctaLabel}${contactLine}`, placement: format === '9:16' ? 'bottom third, above the platform chrome' : 'bottom third, centred' },
    imagePrompt,
    layout: {
      canvas: spec.label,
      safeAreaPx: { top: marginY, right: marginX, bottom: marginY, left: marginX },
      typeScalePx: { headline: headlinePx, subhead: subheadPx, cta: ctaPx },
      hierarchy: [
        `1. ${headline}`,
        ...(subhead ? [`2. ${subhead}`] : []),
        `${subhead ? 3 : 2}. ${ctaLabel}${contactLine}`,
        `${subhead ? 4 : 3}. ${input.businessName || 'business mark'}${input.place ? ` · ${input.place}` : ''}`,
      ],
      contrast: {
        measure: `brand ${brand} on background ${background}`,
        required: 4.5,
        actual: ratio,
        verdict:
          ratio === null
            ? 'not measurable — pass a hex brand colour'
            : ratio >= 4.5
              ? 'passes the 4.5:1 body-text threshold'
              : 'fails the 4.5:1 body-text threshold: use the background for text and the brand colour for accents',
      },
      negativeSpace: `${Math.round(spec.safeMargin * 100)}% clear margin on every edge; the type block should own one third of the frame.`,
    },
    videoBeats: beats,
    needs: relevantNeeds,
    checklist,
  };
}
