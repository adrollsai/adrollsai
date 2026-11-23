/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped. */
/**
 * The gate every NON-agent creative passes through.
 *
 * The agent's creative path (`build_ad_creative_prompt`) applies the owner's creative directives itself.
 * The daily-creative CRON did not: it built its own prompt with the contact number in it and generated
 * straight away, so a rule like "never put the phone number on any creative" held for the agent and not
 * for the machine that posts every morning. A rule that applies to one of the two paths is not a rule.
 *
 * So: one function, used by the cron (and available to any other generator), that
 *   1. loads the active directives for that account (+ the catalogue item, when known),
 *   2. strips the banned elements OUT of the prompt and the caption before anything is generated,
 *   3. appends the bans to the prompt so the generator is told as well as prevented, and
 *   4. returns whatever still breaks a rule as `blocked` — the caller must not generate then.
 *
 * Pure apart from `loadDirectivesFor`; all the decision logic is testable without a database.
 */

import { findViolations, mergeDirectives, scrubCopy, type CreativeDirectiveSet, type DirectiveBan, type MergedDirectives } from './creative-directives';

/** Read the active playbook's directives, tolerating a database without the column yet. */
export async function loadDirectivesFor(
  db: any,
  userId: string,
  context: { itemId?: string | null; campaignId?: string | null } = {}
): Promise<MergedDirectives & { available: boolean }> {
  try {
    const { data, error } = await db
      .from('business_playbooks')
      .select('creative_directives')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) {
      // A pre-migration database has no column; that is "no directives", not a failure.
      return { ...mergeDirectives(null, context), available: false };
    }
    return { ...mergeDirectives((data?.creative_directives ?? null) as CreativeDirectiveSet, context), available: true };
  } catch {
    return { ...mergeDirectives(null, context), available: false };
  }
}

export interface GatedCreative {
  /** The prompt to send, with banned elements removed and the bans stated in words. */
  prompt: string;
  /** The caption/copy, scrubbed the same way. */
  caption: string;
  /** Every change the gate made, for the log and for the agent to report. */
  applied: string[];
  /** Rules that could not be satisfied by scrubbing — do NOT generate when this is non-empty. */
  blocked: string[];
  bans: DirectiveBan[];
  instructions: string[];
}

/**
 * Apply the directives to a prompt + caption pair.
 *
 * The CONTACT is removed rather than masked: "contact +91…" becomes "contact us", because a prompt that
 * says "contact [removed]" invites the generator to invent a number, which is worse than saying nothing.
 */
export function gateCreative(input: {
  prompt: string;
  caption?: string;
  contact?: string | null;
  directives: MergedDirectives;
}): GatedCreative {
  const { directives } = input;
  const bans = directives.bans;
  const applied: string[] = [];

  let prompt = String(input.prompt ?? '');
  let caption = String(input.caption ?? '');

  const contact = String(input.contact ?? '').trim();
  const digits = contact.replace(/\D/g, '');

  if (bans.length || directives.instructions.length) {
    const before = prompt;
    prompt = scrubCopy(prompt, bans);
    if (prompt !== before) applied.push('scrubbed the image prompt');

    if (caption) {
      const beforeCaption = caption;
      caption = scrubCopy(caption, bans);
      if (caption !== beforeCaption) applied.push('scrubbed the caption');
    }

    if (bans.includes('phone')) {
      // Whatever form the number takes in these strings, it goes.
      if (digits.length >= 8) {
        const pattern = new RegExp(digits.split('').join('[\\s()\\-]*'), 'g');
        const p1 = prompt.replace(pattern, '');
        const c1 = caption.replace(pattern, '');
        if (p1 !== prompt) applied.push('removed the phone number from the prompt');
        if (c1 !== caption) applied.push('removed the phone number from the caption');
        prompt = p1;
        caption = c1;
      }
      // And the phrases around it, which otherwise dangle.
      const contactPhrases = /(contact info|contact us at|call us at|call us on|contact number|contact:|whatsapp us at)[^.\n]*/gi;
      const p2 = prompt.replace(contactPhrases, 'contact us');
      const c2 = caption.replace(contactPhrases, 'contact us');
      if (p2 !== prompt) applied.push('replaced the contact line with "contact us"');
      if (c2 !== caption) applied.push('replaced the caption contact line with "contact us"');
      prompt = p2;
      caption = c2;
    }

    // Tell the generator too: a ban the prompt never mentions is a ban the image may still contain.
    if (bans.length && !/Do NOT (depict|include|write)/i.test(prompt)) {
      prompt += ` Do NOT depict, write or imply any of: ${bans.join(', ')}.`;
      applied.push('added the bans to the prompt');
    }
    if (directives.instructions.length && !prompt.includes('STANDING RULES')) {
      prompt += ` STANDING RULES from the owner: ${directives.instructions.join(' ')}`;
      applied.push('added the owner’s standing instructions to the prompt');
    }
  }

  const blocked = [
    ...findViolations(prompt, bans).map((v) => `prompt → ${v}`),
    ...(caption ? findViolations(caption, bans).map((v) => `caption → ${v}`) : []),
  ];

  return { prompt, caption, applied, blocked, bans, instructions: directives.instructions };
}
