/* eslint-disable @typescript-eslint/no-explicit-any -- vendor responses are untyped. */
/**
 * Checking a FINISHED creative against the owner's rules — with eyes, not hope.
 *
 * Bans (no phone, no price, no emoji) are enforced on the compiled spec, which is text. But a prose rule
 * like "for this project, always show the site plan" is a claim about the PICTURE: the prompt can say
 * "include the site plan" and the model can still return a sunset. The only way to know is to look.
 *
 * So this asks a vision model a yes/no question per rule, and refuses to accept a vague answer: every
 * check must come back `pass: true` for the creative to be deliverable. A malformed answer counts as a
 * failure, because "the checker did not understand the reply" is not evidence that the rule was met.
 *
 * The analyser is injected, so the parsing and the verdict logic are testable without a vendor call.
 */

import type { MergedDirectives } from './creative-directives';

export interface CreativeCheck {
  /** What is being checked, in the owner's words. */
  rule: string;
  /** null when the model's answer could not be used — treated as a failure, never a pass. */
  pass: boolean | null;
  evidence: string;
}

export interface CreativeVerification {
  ok: boolean;
  checks: CreativeCheck[];
  /** Things the creative must be fixed for. Empty when ok. */
  failures: string[];
  /** The model's raw answer, for the log. */
  raw?: string;
}

/** A yes/no question per rule, plus one per ban, plus the one thing an owner always notices. */
export function buildVerificationPrompt(directives: MergedDirectives): string {
  const questions: string[] = [];
  for (const instruction of directives.instructions) {
    questions.push(`Does the image satisfy this rule: "${instruction}"?`);
  }
  for (const ban of directives.bans) {
    if (ban === 'phone') questions.push('Does the image contain a phone number anywhere (text, overlay, footer, watermark)?');
    if (ban === 'price') questions.push('Does the image contain a price, amount in rupees, or a discount figure?');
    if (ban === 'emoji') questions.push('Does the image contain an emoji or a cartoon sticker?');
    if (ban === 'logo') questions.push('Does the image contain a logo or brand mark?');
    if (ban === 'before_after') questions.push('Does the image contain a before/after comparison?');
    if (ban === 'availability') questions.push('Does the image claim availability, scarcity or "only N left"?');
    if (ban === 'deadline') questions.push('Does the image claim a deadline or urgency ("today only", "last day")?');
  }
  // One extra, because a creative whose headline is unreadable or misspelled is not deliverable either.
  questions.push('Is the headline text spelled correctly and fully legible at feed size?');

  return [
    'You are checking a marketing image against the rules the business owner set.',
    'Answer ONLY with JSON, no prose and no markdown fences:',
    '{"checks":[{"rule":"<the question>","pass":true|false,"evidence":"<what you actually see>"}]}',
    'One entry per question below, in order. For a ban question, "pass": true means the banned thing is ABSENT.',
    '',
    'QUESTIONS:',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n');
}

/** How many questions the prompt asks, so a short answer can be detected. */
export function expectedCheckCount(directives: MergedDirectives): number {
  return directives.instructions.length + directives.bans.length + 1;
}

/**
 * Parse the model's answer into checks.
 *
 * Tolerant about the wrapper (fences, leading prose) and strict about the content: an entry without a
 * boolean `pass` is recorded as `pass: null` and fails the creative rather than being ignored.
 */
export function parseVerificationAnswer(raw: string): CreativeCheck[] {
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];

  let parsed: any = null;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const list = Array.isArray(parsed?.checks) ? parsed.checks : Array.isArray(parsed) ? parsed : [];
  return list
    .filter((entry: any) => entry && typeof entry === 'object')
    .map((entry: any) => ({
      rule: String(entry.rule ?? '').trim(),
      pass: typeof entry.pass === 'boolean' ? entry.pass : entry.pass === 'true' ? true : entry.pass === 'false' ? false : null,
      evidence: String(entry.evidence ?? '').trim().slice(0, 300),
    }))
    .filter((entry: CreativeCheck) => entry.rule.length > 0);
}

/**
 * Verify a finished creative.
 *
 * `analyse` is the vendor call: (imageUrl, questionPrompt) => text answer. Injected so this module stays
 * testable, and so a caller can pass a cheaper model without touching the logic.
 */
export async function verifyCreativeAgainstDirectives(input: {
  imageUrl: string;
  directives: MergedDirectives;
  analyse: (imageUrl: string, question: string) => Promise<string>;
}): Promise<CreativeVerification> {
  const needed = expectedCheckCount(input.directives);
  if (needed <= 1) {
    return { ok: true, checks: [], failures: [] };
  }

  const question = buildVerificationPrompt(input.directives);
  let raw = '';
  try {
    raw = await input.analyse(input.imageUrl, question);
  } catch (e: any) {
    return {
      ok: false,
      checks: [],
      failures: [`the check could not run (${e?.message || 'vision call failed'}) — the creative is unverified, so it must not be delivered as compliant`],
      raw: String(e?.message || ''),
    };
  }

  const checks = parseVerificationAnswer(raw);
  const failures: string[] = [];

  if (!checks.length) {
    failures.push('the check returned nothing usable, so the creative is unverified');
  } else if (checks.length < needed) {
    failures.push(`only ${checks.length} of ${needed} rules came back checked, so the rest are unverified`);
  }
  for (const check of checks) {
    if (check.pass === true) continue;
    if (check.pass === null) failures.push(`${check.rule} — the answer was not a yes/no (${check.evidence || 'no evidence'})`);
    else failures.push(`${check.rule} — FAILED: ${check.evidence || 'no evidence given'}`);
  }

  return { ok: failures.length === 0, checks, failures, raw: String(raw).slice(0, 2000) };
}
