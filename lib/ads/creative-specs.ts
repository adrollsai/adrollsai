/**
 * Ad copy the platform will actually accept, and copy a human would not be embarrassed by.
 *
 * WHY THIS IS CODE AND NOT A PARAGRAPH IN A SKILL
 * The vendored `ad-creative` skill states the character limits and names the phrases that make copy
 * read as machine-written. Prose is how the agent is TOLD; this is how the product KNOWS. The
 * difference is not pedantry — it is the one that has already bitten this repo twice:
 *
 *   - `lib/agent/tools/ads.ts` has carried `describe('Max 40 characters')` on the Meta headline
 *     since the launcher was written. That is advice to a model, not a limit. A 51-character
 *     headline passes the schema, gets sent, and Meta truncates it mid-word with no error. The
 *     advertiser finds out when a customer reads "...starting at ₹85,00,0".
 *   - Nothing anywhere checked for the copy tics the skill bans. Generate thirty creatives a day
 *     and the batch multiplies its first draft's habit thirty times: every ad opening on "Unlock",
 *     every offer "reimagined", every third line an em dash.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It does not rewrite judgement. "It's not a flat, it's a lifestyle" is a bad line, and no regex is
 * qualified to replace it with a good one. So the split is:
 *
 *   MECHANICAL  an em dash, a trailing space, a curly quote, a doubled word — fixed by
 *               `sanitizeCopy`, because the fix is not a matter of taste.
 *   JUDGEMENT   a stock phrase, a contrast reveal, a stacked negation — REPORTED by
 *               `findCopyViolations` with a concrete alternative, never silently rewritten.
 *
 * The character limits sit in the first category: over the cap, the platform truncates, so the
 * trimmed alternative is computed here and handed back ready to use.
 *
 * PURE: no clock, no network, no database. Everything is a string in, a verdict out.
 */

/** The platforms we write copy for. Meta today; the rest are the expansion the specs already cover. */
export type AdPlatform = 'meta' | 'google_ads' | 'linkedin' | 'tiktok' | 'x';

/** One copy field, as the platform defines it. */
export interface CopyFieldSpec {
  /**
   * The cap we ENFORCE. For most fields this is the point at which the platform truncates what the
   * reader sees, which is the number that matters to a customer, not the API maximum.
   */
  limit: number;
  /** The platform's own hard maximum, when it differs from what is shown. */
  absolute?: number;
  /** How many of this field the platform allows. */
  max?: number;
  /** Why the number is what it is, so nobody "simplifies" it later. */
  note: string;
}

export interface PlatformSpec {
  label: string;
  /** The platform's own name for the placement, for error messages. */
  fields: Record<string, CopyFieldSpec>;
}

/**
 * The limits table.
 *
 * Sources: the vendored `ad-creative` skill's `platform-specs` reference, cross-checked against the
 * shapes `lib/ads/launch-service.ts` and `lib/agent/mcp/meta-ads-mcp.ts` actually send. Where the
 * two disagreed, the field the API receives won — a limit that is true in a document and false in
 * our payload is how the truncation bug survived.
 */
export const PLATFORM_COPY_SPECS: Record<AdPlatform, PlatformSpec> = {
  meta: {
    label: 'Meta Ads (Facebook & Instagram)',
    fields: {
      headline: {
        limit: 40,
        absolute: 255,
        note: 'Truncated after ~40 characters below the image. This is the field that gets cut mid-word.',
      },
      primary_text: {
        limit: 125,
        absolute: 2200,
        note: 'Only the first ~125 characters show before "See more". Front-load the hook.',
      },
      description: {
        limit: 30,
        absolute: 255,
        note: 'May not show at all depending on placement; keep it complementary to the headline.',
      },
    },
  },
  google_ads: {
    label: 'Google Ads (Responsive Search Ads)',
    fields: {
      headline: {
        limit: 30,
        absolute: 30,
        max: 15,
        note: 'Hard cap, not a truncation. Any three may appear together in any order, so each must read alone.',
      },
      long_headline: { limit: 90, absolute: 90, max: 5, note: 'Performance Max and Display only.' },
      description: { limit: 90, absolute: 90, max: 4, note: 'Any two may be shown together.' },
      display_path: { limit: 15, absolute: 15, max: 2, note: 'Appended to the domain in the visible URL.' },
      business_name: {
        limit: 25,
        absolute: 25,
        note: 'Required on every ad, and the reader sees it; a truncated business name reads as a typo.',
      },
    },
  },
  linkedin: {
    label: 'LinkedIn Ads',
    fields: {
      intro_text: { limit: 150, absolute: 600, note: 'Truncated after ~150 characters above the image.' },
      headline: { limit: 70, absolute: 200, note: 'Below the image; the strongest line LinkedIn shows.' },
      description: { limit: 100, absolute: 300, note: 'Only shows on some placements.' },
    },
  },
  tiktok: {
    label: 'TikTok Ads',
    fields: {
      ad_text: { limit: 80, absolute: 100, note: 'Above the video. Most viewers have sound off.' },
      display_name: { limit: 40, absolute: 40, note: 'The brand name as it appears in the ad.' },
    },
  },
  x: {
    label: 'Twitter/X Ads',
    fields: {
      tweet_text: { limit: 280, absolute: 280, note: 'The whole ad copy for a promoted post.' },
      headline: { limit: 70, absolute: 70, note: 'Website card headline.' },
      description: { limit: 200, absolute: 200, note: 'Website card description.' },
    },
  },
};

/** Every platform we have specs for. */
export const AD_PLATFORMS = Object.keys(PLATFORM_COPY_SPECS) as AdPlatform[];

/** True when the platform is one we can validate against. */
export function isAdPlatform(value: unknown): value is AdPlatform {
  return typeof value === 'string' && (AD_PLATFORMS as string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Character limits
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface FieldVerdict {
  field: string;
  text: string;
  length: number;
  limit: number;
  over: boolean;
  /** Characters that will never be seen. Zero when the field fits. */
  truncatedBy: number;
  /** A version that fits, cut on a word boundary. Always present when `over`. */
  trimmed?: string;
  note?: string;
}

/**
 * Cut a string to at most `limit` characters without splitting a word.
 *
 * Splitting mid-word is exactly the failure being prevented, so this walks back to the last space
 * and drops a trailing comma or "and". Only when a single word is itself longer than the limit does
 * it hard-cut, because otherwise a long product name would return nothing at all.
 */
export function trimToLimit(text: string, limit: number): string {
  const value = String(text ?? '').trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const candidate = (lastSpace > 0 ? cut.slice(0, lastSpace) : value.slice(0, limit))
    .replace(/[\s,;:.\-–—]+$/, '')
    .trim();
  return candidate.length ? candidate : value.slice(0, limit).trim();
}

/** Length as the platform counts it: a UTF-16 length, which is what every one of these APIs uses. */
export function copyLength(text: string): number {
  return String(text ?? '').length;
}

/**
 * Check one field against its platform limit.
 *
 * Returns `over: false` for a field the platform does not define rather than throwing: an unknown
 * field name is a caller mistake that must not stop a launch, but it must be visible, so it is
 * reported through `checkAdCopy`'s `unknownFields`.
 */
export function checkField(platform: AdPlatform, field: string, text: string): FieldVerdict {
  const spec = PLATFORM_COPY_SPECS[platform]?.fields?.[field];
  const value = String(text ?? '');
  if (!spec) {
    return { field, text: value, length: copyLength(value), limit: 0, over: false, truncatedBy: 0 };
  }
  const length = copyLength(value);
  const over = length > spec.limit;
  return {
    field,
    text: value,
    length,
    limit: spec.limit,
    over,
    truncatedBy: over ? length - spec.limit : 0,
    ...(over ? { trimmed: trimToLimit(value, spec.limit) } : {}),
    note: spec.note,
  };
}

export interface AdCopyInput {
  headline?: string;
  primary_text?: string;
  description?: string;
  /** Google only. */
  long_headline?: string;
  display_path?: string;
  business_name?: string;
  /** LinkedIn only. */
  intro_text?: string;
  /** TikTok only. */
  ad_text?: string;
  display_name?: string;
  /** X only. */
  tweet_text?: string;
}

export interface AdCopyCheck {
  platform: AdPlatform;
  ok: boolean;
  fields: FieldVerdict[];
  overLimit: FieldVerdict[];
  /** Copy tics found across every field. See findCopyViolations. */
  violations: CopyViolation[];
  /** Fields supplied that this platform does not define. Reported, never fatal. */
  unknownFields: string[];
  /** One paragraph a human can act on. Empty when `ok`. */
  summary: string;
}

/**
 * Check a whole ad against a platform: does it fit, and does it read as written by a person.
 *
 * `ok` requires both. A headline inside 40 characters that says "Unlock the power of what's next"
 * is not shippable copy, it is a shorter bad ad.
 */
export function checkAdCopy(platform: AdPlatform, copy: AdCopyInput): AdCopyCheck {
  const spec = PLATFORM_COPY_SPECS[platform];
  const fields: FieldVerdict[] = [];
  const unknownFields: string[] = [];

  for (const [field, raw] of Object.entries(copy || {})) {
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    if (!spec?.fields?.[field]) {
      unknownFields.push(field);
      continue;
    }
    fields.push(checkField(platform, field, String(raw)));
  }

  const violations: CopyViolation[] = [];
  for (const verdict of fields) {
    for (const issue of findCopyViolations(verdict.text)) {
      violations.push({ ...issue, field: verdict.field });
    }
  }

  const overLimit = fields.filter((verdict) => verdict.over);
  const blocking = violations.filter((issue) => issue.severity === 'block');
  const ok = overLimit.length === 0 && blocking.length === 0;

  const summaryParts: string[] = [];
  if (overLimit.length) {
    summaryParts.push(
      overLimit
        .map(
          (verdict) =>
            `${verdict.field} is ${verdict.length}/${verdict.limit} — ${verdict.truncatedBy} characters will never be shown`,
        )
        .join('; ') + '.',
    );
  }
  if (blocking.length) {
    summaryParts.push(`Copy that must be rewritten: ${blocking.map((issue) => issue.why).join(' ')}`);
  }
  if (unknownFields.length) {
    summaryParts.push(
      `${unknownFields.join(', ')} ${unknownFields.length === 1 ? 'is' : 'are'} not a ${spec.label} field and will be dropped.`,
    );
  }

  return {
    platform,
    ok,
    fields,
    overLimit,
    violations,
    unknownFields,
    summary: ok ? '' : summaryParts.join(' '),
  };
}

/**
 * Make copy fit and drop the tics whose fix is not a matter of taste.
 *
 * This is the difference between a rule that blocks a launch and a rule that improves one. An ad
 * with an em dash in the headline is not a compliance failure, it is a draft that needs a comma; so
 * this repairs it and reports what it changed, and the caller ships the repaired copy.
 *
 * Returns `overLimit` verdicts untouched — a too-long headline is a WRITING problem (there is a
 * better 40-character line), which `checkAdCopy` reports and the agent resolves. Fitting it here
 * would silently ship a sentence with its end cut off.
 */
export function sanitizeCopy(text: string): { text: string; changed: string[] } {
  let value = String(text ?? '');
  const changed: string[] = [];

  if (/[—–]/.test(value)) {
    // An em dash between two clauses is a full stop in disguise; between words it is a comma.
    // The character that follows starts a new sentence, so it is capitalised here — otherwise
    // "Site visits open Saturday — call now" repairs to "Saturday. call now", which is worse
    // than the dash it replaced.
    value = value
      .replace(/\s*—\s*(\S)?/g, (_match, next: string | undefined) => (next ? `. ${next.toUpperCase()}` : '. '))
      .replace(/\s*–\s*/g, ', ');
    changed.push('replaced an em/en dash with punctuation');
  }
  if (/[“”]/.test(value)) {
    value = value.replace(/[“”]/g, '"');
    changed.push('straightened curly quotes');
  }
  if (/[‘’]/.test(value)) {
    value = value.replace(/[‘’]/g, "'");
    changed.push('straightened curly apostrophes');
  }
  if (/\s{2,}/.test(value)) {
    value = value.replace(/\s{2,}/g, ' ');
    changed.push('collapsed repeated spaces');
  }
  const doubled = /\b(\w{3,})\s+\1\b/i.test(value);
  if (doubled) {
    value = value.replace(/\b(\w{3,})\s+\1\b/gi, '$1');
    changed.push('removed a doubled word');
  }
  if (/\s+$/.test(value) || /^\s+/.test(value)) {
    value = value.trim();
    changed.push('trimmed whitespace');
  }
  // A repaired em dash can leave ".." or a stray space before punctuation.
  if (/\.\s*\./.test(value)) {
    value = value.replace(/\.\s*\./g, '.');
  }
  value = value.replace(/\s+([,.;:!?])/g, '$1');

  return { text: value, changed };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Copy that reads as generated
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Severity.
 *
 * `block`   never legitimate in ad copy: the phrase itself is the problem, and no context redeems
 *           "Unlock the power of". A launch carrying one of these is a draft, not an ad.
 * `warn`    usually bad, occasionally right: a contrast reveal can be the whole joke of a good ad,
 *           so it is reported and the caller decides. Nothing here ever blocks a launch.
 */
export type CopySeverity = 'block' | 'warn';

export interface CopyViolation {
  /** Stable id, so a caller can suppress or count one kind. */
  rule: string;
  severity: CopySeverity;
  /** The exact text that matched. */
  match: string;
  /** What is wrong, in the words an owner would use. */
  why: string;
  /** What to write instead. */
  fix: string;
  /** Which copy field it came from, filled in by checkAdCopy. */
  field?: string;
}

/** Stock phrases. Literal enough that a case-insensitive substring is the honest test. */
const STOCK_PHRASES: { phrase: string; fix: string }[] = [
  { phrase: 'say goodbye to', fix: 'Name what stops, e.g. "No more site visits on Sundays."' },
  { phrase: 'unlock the power', fix: 'Say what it does, e.g. "Book a site visit in two taps."' },
  { phrase: 'take it to the next level', fix: 'Name the next level. A number, a date, a result.' },
  { phrase: "here's the thing", fix: 'Delete it and start with the thing itself.' },
  { phrase: 'here is the thing', fix: 'Delete it and start with the thing itself.' },
  { phrase: 'reimagined', fix: 'Say what changed for the buyer, not that it changed.' },
  { phrase: 'game-changer', fix: 'Say the specific difference.' },
  { phrase: 'cutting-edge', fix: 'Name the feature that earns the word.' },
  { phrase: 'state-of-the-art', fix: 'Name the feature that earns the word.' },
  { phrase: 'seamless experience', fix: 'Say what the buyer never has to do.' },
  { phrase: 'in today\u2019s fast-paced', fix: 'Delete the whole opening clause.' },
  { phrase: "in today's fast-paced", fix: 'Delete the whole opening clause.' },
  { phrase: 'get started today', fix: 'Name the action and what they get, e.g. "Book a site visit".' },
  { phrase: 'join thousands of happy', fix: 'Use one real named customer, or drop the claim.' },
  { phrase: 'happy customers', fix: 'One real testimonial beats a count nobody can verify.' },
  { phrase: 'stop scrolling', fix: 'Open on something specific to this buyer instead.' },
  { phrase: 'here\u2019s what nobody tells you', fix: 'Just tell them the thing.' },
  { phrase: "here's what nobody tells you", fix: 'Just tell them the thing.' },
  { phrase: 'you won\u2019t believe', fix: 'Describe the thing that is surprising.' },
  { phrase: "you won't believe", fix: 'Describe the thing that is surprising.' },
];

/**
 * Phrases that signal generated copy.
 *
 * Every pattern here is deliberately anchored to a phrase with more than one word, because the cost
 * of a false positive is an owner being told their own sentence is bad. The one exception is the em
 * dash, which `sanitizeCopy` handles mechanically rather than complaining about.
 */
const AI_TELL_PATTERNS: { rule: string; severity: CopySeverity; re: RegExp; why: string; fix: string }[] = [
  {
    rule: 'contrast-reveal',
    severity: 'warn',
    re: /\b(?:it|this|that)(?:'s|\s+is)\s+not\s+[^.,!?\n]{1,60}[.,]\s*(?:it|this|that)(?:'s|\s+is)\b/i,
    why: 'A contrast reveal ("it is not X, it is Y") is the most recognisable generated construction.',
    fix: 'State Y directly, with the reason. "Two minutes from the metro" beats "it is not just a location".',
  },
  {
    rule: 'not-because',
    severity: 'warn',
    re: /\bnot\s+because\b[^.!?\n]{1,60}[.!?]\s*(?:but\s+)?because\b/i,
    why: 'The "not because X. Because Y." construction is a generated tell.',
    fix: 'Give the real reason on its own.',
  },
  {
    rule: 'stacked-negation',
    severity: 'warn',
    re: /\bno\s+[a-z][\w']*(?:\s+[\w']+){0,2}\s*,\s*no\s+[a-z][\w']*(?:\s+[\w']+){0,2}\s*,\s*no\s+[a-z]/i,
    why: 'Three or more stacked "no X, no Y, no Z" clauses read as a character-limit filler.',
    fix: 'Keep the one absence that matters and spend the rest of the space on a fact.',
  },
  {
    rule: 'self-answered-question',
    severity: 'warn',
    re: /(?:^|[.!?]\s*)(?:the\s+)?(?:result|best\s+part|answer|secret|kicker|catch|problem)\s*\?/i,
    why: 'A question the copy immediately answers itself is a generated tell.',
    fix: 'Answer it in the same sentence, or ask a question the reader is actually asking.',
  },
  {
    rule: 'colon-reveal',
    severity: 'warn',
    re: /\b(?:the\s+)?(?:result|best\s+part|answer|secret|kicker)\s*:\s*\S/i,
    why: 'The "The result: X" colon reveal is a generated tell.',
    fix: 'Say it plainly: "Handover in March."',
  },
  {
    rule: 'pov-hook',
    severity: 'warn',
    re: /^\s*POV\s*:/i,
    why: 'A "POV:" hook is only acceptable when the situation is hyper-specific to the viewer.',
    fix: 'If it is not specific ("POV: it is 3pm and you are on your fourth coffee"), open on the specific thing instead.',
  },
];

/**
 * Find the copy tics in one field of copy.
 *
 * Ordered blocking-first so a caller that takes `[0]` gets the thing that must change.
 */
export function findCopyViolations(text: string): CopyViolation[] {
  const value = String(text ?? '');
  if (!value.trim()) return [];
  const found: CopyViolation[] = [];
  const lower = value.toLowerCase();

  // An em dash is not a warning sign, it is a house rule: the skill bans it in every ad field.
  const dash = /[—–]/.exec(value);
  if (dash) {
    found.push({
      rule: 'dash',
      severity: 'block',
      match: dash[0],
      why: 'An em or en dash is banned in ad copy on this platform.',
      fix: 'Use a full stop, a comma, or a line break.',
    });
  }

  for (const entry of STOCK_PHRASES) {
    const at = lower.indexOf(entry.phrase);
    if (at === -1) continue;
    found.push({
      rule: 'stock-phrase',
      severity: 'block',
      match: value.slice(at, at + entry.phrase.length),
      why: `"${value.slice(at, at + entry.phrase.length)}" is a stock phrase that reads as generated.`,
      fix: entry.fix,
    });
  }

  for (const pattern of AI_TELL_PATTERNS) {
    const match = pattern.re.exec(value);
    if (!match) continue;
    found.push({
      rule: pattern.rule,
      severity: pattern.severity,
      match: match[0].trim(),
      why: pattern.why,
      fix: pattern.fix,
    });
  }

  const seen = new Set<string>();
  return found.filter((issue) => {
    const key = `${issue.rule}:${issue.match.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Violations that `sanitizeCopy` repairs by itself, so they must never block a launch.
 *
 * This constant exists so the knowledge lives in exactly one place: `validateLaunchRequest` filters
 * on it rather than hard-coding `rule !== 'dash'`, and adding a new mechanically-repairable rule
 * later cannot leave the launcher refusing a launch it is itself about to fix.
 */
export const MECHANICALLY_REPAIRED_RULES = ['dash'] as const;

/**
 * The hard requirement, as a boolean: nothing here may ship.
 *
 * Kept separate from `findCopyViolations` because the two questions are different. "Is this draft
 * generated?" is answered by the full list; "may I launch this?" is answered by this.
 */
export function hasBlockingCopy(text: string): boolean {
  return findCopyViolations(text).some((issue) => issue.severity === 'block');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Test hypotheses
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface HypothesisCheck {
  ok: boolean;
  /** The parts of a falsifiable hypothesis that are missing. */
  missing: ('metric' | 'comparison' | 'direction')[];
  summary: string;
}

/**
 * A hypothesis a result can prove wrong.
 *
 * The skill's rule, as a check: "This will resonate with renters" cannot lose, so shipping it
 * teaches nothing. "Beats the control on CTR among renters" can. Three parts are required — the
 * METRIC (CTR, CVR, CPA, cost per lead), what it is COMPARED against, and the expected DIRECTION.
 *
 * Used when a creative is queued as a test rather than as a shot in the dark.
 */
export function checkTestHypothesis(text: string): HypothesisCheck {
  const value = String(text ?? '');
  const lower = value.toLowerCase();
  const hasMetric = /\b(ctr|click[- ]through|cvr|conversion rate|cost per (?:lead|result|click)|\bcpa\b|\bcpl\b|roas|thumb[- ]?stop|hook rate|retention)\b/.test(
    lower,
  );
  const hasComparison = /\b(?:vs\.?|versus|against|control|than|compared (?:to|with)|beats?|beat)\b/.test(lower);
  const hasDirection = /\b(?:higher|lower|better|worse|more|fewer|improv\w*|lift\w*|drop\w*|increase\w*|decrease\w*|[+\-]\s?\d+\s?%)\b/.test(
    lower,
  );

  const missing: HypothesisCheck['missing'] = [];
  if (!hasMetric) missing.push('metric');
  if (!hasComparison) missing.push('comparison');
  if (!hasDirection) missing.push('direction');

  const ok = missing.length === 0;
  const summary = ok
    ? 'Falsifiable: it names a metric, what it is measured against, and the expected direction.'
    : `Not falsifiable yet — add ${missing.join(', ')}. Example: "beats the current creative on CTR among site-visit leads, +15% or more."`;

  return { ok, missing, summary };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The rules, as prompt text
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The limits and the bans as a compact block for a prompt.
 *
 * This is what makes the routine flow and an on-demand creation follow the same rules without
 * either of them loading the 27 KB skill: the numbers that get enforced and the phrases that get
 * rejected, stated once, in the place the agent reads before it writes.
 *
 * `platform` narrows it to one platform; omit for every platform we support.
 */
export function adCopyRulesForPrompt(platform?: AdPlatform): string {
  const platforms = platform ? [platform] : AD_PLATFORMS;
  const lines: string[] = ['AD COPY RULES (enforced in code — a violation blocks the launch):'];
  for (const key of platforms) {
    const spec = PLATFORM_COPY_SPECS[key];
    if (!spec) continue;
    const fields = Object.entries(spec.fields)
      .map(([field, meta]) => `${field} ≤${meta.limit}`)
      .join(', ');
    lines.push(`- ${spec.label}: ${fields}`);
  }
  lines.push(
    '- Never write: em dashes; "unlock the power", "say goodbye to", "reimagined", "take it to the next level",',
    '  "here\'s the thing", "game-changer", "cutting-edge", "state-of-the-art", "seamless experience",',
    '  "get started today", "join thousands of happy customers", "stop scrolling".',
    '- Avoid: contrast reveals ("it is not X, it is Y"), three stacked negations, self-answered questions',
    '  ("The result? 3x faster"), and a bare "POV:" hook.',
    '- Specific beats clever: a number, a date, a place, or a named outcome. If you have none, say so.',
    '- Make one point per ad. Several messages in one creative is how a reader remembers none of them.',
  );
  return lines.join('\n');
}
