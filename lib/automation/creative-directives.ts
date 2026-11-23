/* eslint-disable @typescript-eslint/no-explicit-any -- playbook JSON is untyped. */
/**
 * Creative directives: standing instructions about what a creative may and may not contain.
 *
 * THE CONTROL THE OWNER ASKED FOR
 *   "for THIS property, the creative should look like this every time - and no phone number on it"
 *   "don't put the number on ANY of the daily creatives"
 *
 * Neither existed. Global tone guidance could go in the playbook's recipes (prose the model may or may
 * not follow), and a per-property note had nowhere to live at all. So the honest answer was "it can try".
 * What makes this real is the split:
 *
 *   INSTRUCTIONS are prose, for the model: "warm, calm, no hard sell".
 *   BANS are machine-checkable: phone, price, emoji, logo, before_after, availability.
 *
 * A ban is not advice — `applyDirectives` removes the banned element from the compiled spec BEFORE an
 * image is generated, and `findViolations` proves the result is clean afterwards. That is the difference
 * between "the agent was told" and "the agent cannot ship the wrong thing".
 *
 * WHERE THEY LIVE
 * In the ACTIVE PLAYBOOK, under the `creative_directives` section, because that is already versioned,
 * archived on every write, and editable by the agent in plain language:
 *
 *   { global: Directive[], properties: { "<property id>": Directive[] }, campaigns: { "<campaign id>": Directive[] } }
 *
 * Pure: no database, no clock. The playbook is passed in.
 */

export const DIRECTIVE_BANS = [
  'phone',
  'price',
  'emoji',
  'logo',
  'before_after',
  'availability',
  'deadline',
] as const;

export type DirectiveBan = (typeof DIRECTIVE_BANS)[number];

export interface CreativeDirective {
  /** Stable id so the owner can say "remove the third one". */
  id?: string;
  /** What the creative must do, in the owner's words. Read by the model. */
  instruction: string;
  /** What it must never contain. Enforced in code. */
  bans?: DirectiveBan[];
  active?: boolean;
}

export interface CreativeDirectiveSet {
  global?: CreativeDirective[];
  /**
   * Per CATALOGUE ITEM rules, keyed by item id. Vertical-neutral on purpose: a film academy has
   * courses, a clinic has treatments, and neither calls its catalogue items "properties".
   */
  items?: Record<string, CreativeDirective[]>;
  /** Legacy key from the first version; read as an alias of `items` so nothing is lost. */
  properties?: Record<string, CreativeDirective[]>;
  campaigns?: Record<string, CreativeDirective[]>;
}

export interface MergedDirectives {
  instructions: string[];
  bans: DirectiveBan[];
  /** Which scopes contributed, so an answer can say where a rule came from. */
  sources: string[];
}

function cleanList(list: unknown): CreativeDirective[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry: any) => ({
      id: typeof entry.id === 'string' ? entry.id : undefined,
      instruction: String(entry.instruction ?? '').trim(),
      bans: Array.isArray(entry.bans)
        ? entry.bans.map((b: any) => String(b).trim().toLowerCase()).filter((b: string) => (DIRECTIVE_BANS as readonly string[]).includes(b)) as DirectiveBan[]
        : [],
      active: entry.active !== false,
    }))
    .filter((entry) => entry.active && (entry.instruction.length > 0 || (entry.bans || []).length > 0));
}

/**
 * Every directive that applies to one creative: global first, then the property's, then the campaign's.
 *
 * Order matters for the reader, not for precedence: bans UNION (a ban anywhere wins), and instructions
 * are concatenated most-specific-last so the model reads the general rule before the exception.
 */
export function mergeDirectives(
  set: CreativeDirectiveSet | null | undefined,
  context: { propertyId?: string | null; campaignId?: string | null } = {}
): MergedDirectives {
  const instructions: string[] = [];
  const bans = new Set<DirectiveBan>();
  const sources: string[] = [];

  const take = (list: CreativeDirective[] | undefined, label: string) => {
    const cleaned = cleanList(list);
    if (!cleaned.length) return;
    sources.push(label);
    for (const directive of cleaned) {
      if (directive.instruction) instructions.push(directive.instruction);
      for (const ban of directive.bans || []) bans.add(ban);
    }
  };

  take(set?.global, 'every creative');
  if (context.propertyId) {
    take(set?.items?.[context.propertyId] ?? set?.properties?.[context.propertyId], `this catalogue item (${context.propertyId})`);
  }
  if (context.campaignId) take(set?.campaigns?.[context.campaignId], `this campaign (${context.campaignId})`);

  return { instructions, bans: [...bans], sources };
}

/** Phone-shaped text: 10+ digits, optionally with spaces/dashes/+91, and the words around it. */
const PHONE_PATTERN = /(\+?\d[\d\s\-().]{8,}\d)/;
/** Money in Indian notation: ₹85,00,000, Rs 85 lakh, 85,00,000/- */
const PRICE_PATTERN = /(₹|rs\.?|inr)\s*[\d,]+(\.\d+)?(\s*(lakh|lakhs|lac|lacs|cr|crore|crores|k))?|\b\d{2},\d{2},\d{3}\b/i;
/** Emoji: the pictographic ranges any generator will happily draw. */
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

/** Words that promise things the business may not be able to keep. */
const AVAILABILITY_PATTERN = /\b(available now|immediately available|only \d+ left|last few|sold out|booking open)\b/i;
const DEADLINE_PATTERN = /\b(today only|tonight only|last day|expires|hurry|limited time|offer ends)\b/i;

/**
 * Anything in this text that a ban forbids. Used to PROVE a creative is clean rather than assume it.
 *
 * Returns one line per violation, each naming the rule and quoting what matched, so the agent can fix
 * the specific thing instead of regenerating blindly.
 */
export function findViolations(text: string, bans: DirectiveBan[]): string[] {
  const body = String(text ?? '');
  const out: string[] = [];
  const note = (ban: DirectiveBan, detail: string) => out.push(`${ban}: ${detail}`);

  for (const ban of bans) {
    if (ban === 'phone') {
      const match = body.match(PHONE_PATTERN);
      if (match) note('phone', `contains "${match[0].trim()}"`);
    }
    if (ban === 'price') {
      const match = body.match(PRICE_PATTERN);
      if (match) note('price', `contains "${match[0].trim()}"`);
    }
    if (ban === 'emoji') {
      const match = body.match(EMOJI_PATTERN);
      if (match) note('emoji', `contains "${match[0]}"`);
    }
    if (ban === 'availability') {
      const match = body.match(AVAILABILITY_PATTERN);
      if (match) note('availability', `claims "${match[0]}"`);
    }
    if (ban === 'deadline') {
      const match = body.match(DEADLINE_PATTERN);
      if (match) note('deadline', `claims "${match[0]}"`);
    }
  }
  return out;
}

/** Strip the banned elements out of a piece of copy, rather than refusing the whole creative. */
export function scrubCopy(text: string, bans: DirectiveBan[]): string {
  let out = String(text ?? '');
  if (bans.includes('phone')) out = out.replace(PHONE_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
  if (bans.includes('price')) out = out.replace(PRICE_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
  if (bans.includes('emoji')) out = out.replace(new RegExp(EMOJI_PATTERN.source, 'gu'), '').trim();
  if (bans.includes('deadline')) out = out.replace(DEADLINE_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
  if (bans.includes('availability')) out = out.replace(AVAILABILITY_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
  // Tidy the punctuation an excision leaves behind.
  return out.replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,;:.]+|[\s,;:]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}

export interface DirectiveApplication<T> {
  value: T;
  applied: string[];
  bans: DirectiveBan[];
  /** Present when the text could not be fully cleaned — the caller must NOT ship it. */
  violations: string[];
}

/**
 * Apply the directives to a compiled creative spec.
 *
 * The contact is dropped outright when `phone` is banned: the compiler turns a contact into a call CTA
 * and prints the number into the image instructions, so removing it afterwards would leave "Call" with
 * no way to call — better to compose with no contact at all (the CTA falls back to a visit).
 */
export function applyDirectivesToSpec<T extends Record<string, any>>(spec: T, merged: MergedDirectives): DirectiveApplication<T> {
  const bans = merged.bans;
  if (!bans.length && !merged.instructions.length) {
    return { value: spec, applied: [], bans: [], violations: [] };
  }

  const applied: string[] = [];
  let contactRemoved = false;

  /**
   * Scrub EVERY string in the spec, not a hand-picked list of fields.
   *
   * The first version scrubbed headline/subhead/offerLine/imagePrompt only — and the phone number was
   * still in the spec, because the compiler also prints the contact into `layout` (the pixel layout's CTA
   * block) and into `messageBlocks`/`checklist`. A directive that leaves the number in the brief is worse
   * than no directive: it looks enforced.
   */
  const scrubDeep = (value: any, key?: string): any => {
    if (typeof value === 'string') {
      const cleaned = scrubCopy(value, bans);
      return cleaned;
    }
    if (Array.isArray(value)) return value.map((entry) => scrubDeep(entry));
    if (value && typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        if (bans.includes('phone') && /^contact/i.test(childKey) && childValue) {
          contactRemoved = true;
          continue;
        }
        out[childKey] = scrubDeep(childValue, childKey);
      }
      return out;
    }
    void key;
    return value;
  };

  const next = scrubDeep(spec) as Record<string, any>;

  if (contactRemoved) applied.push('removed the contact number, so the CTA is "visit" instead of "call"');
  for (const field of ['headline', 'subhead', 'offerLine', 'ctaLabel', 'imagePrompt']) {
    if (typeof next[field] === 'string' && typeof (spec as any)[field] === 'string' && next[field] !== (spec as any)[field]) {
      applied.push(`scrubbed ${field}`);
    }
  }

  // The model's own instructions carry the bans too, so a later step cannot reintroduce them.
  if (typeof next.imagePrompt === 'string' && bans.length) {
    const banLine = ` Do NOT depict or write any of: ${bans.join(', ')}.`;
    if (!next.imagePrompt.includes('Do NOT depict or write any of:')) next.imagePrompt += banLine;
  }

  const flat = JSON.stringify(next);
  const violations = findViolations(flat, bans);

  return { value: next as T, applied, bans, violations };
}

/** What the routine brief should say, in the owner's words plus the machine rules. */
export function directiveBriefLines(merged: MergedDirectives): string[] {
  if (!merged.instructions.length && !merged.bans.length) return [];
  const lines: string[] = ['CREATIVE DIRECTIVES (standing instructions — they outrank your own taste):'];
  for (const instruction of merged.instructions) lines.push(`- ${instruction}`);
  if (merged.bans.length) {
    lines.push(
      `- HARD BANS, checked mechanically after you compose: ${merged.bans.join(', ')}. ` +
        'These are not preferences. A creative that contains one is not delivered, so leave them out of the copy and the image prompt.'
    );
  }
  if (merged.sources.length) lines.push(`- These came from: ${merged.sources.join('; ')}.`);
  return lines;
}
