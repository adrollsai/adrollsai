/**
 * Which template the Saturday check-in uses, per industry.
 *
 * HOW IT WORKS TODAY, STATED PLAINLY
 * Every account gets the same template: `nobogent_weekly_checkin_v2`, whose body is fixed and whose
 * buttons are fixed (View Offerings / Talk to Expert / Book an Appointment). It was made generic by
 * REMOVING the industry vocabulary — v1 said "our latest options" and carried the lead's name, which
 * read as a property business to everybody else.
 *
 * That is safe, and it is not tailored. A film academy and a plot developer get the same three
 * buttons, and "View Offerings" is the compromise. Buttons live INSIDE an approved template — Meta
 * approves the words — so tailoring cannot be done by rewording at send time. It needs a per-industry
 * template that is approved on that account's number, chosen at send time.
 *
 * This module makes that choice, and makes the fallback explicit:
 *
 *   industry template approved on this number   → use it ("View Properties", "View Courses", …)
 *   no industry template                        → the generic v2, and say so in the log
 *   not even the generic one is approved        → DO NOT SEND, and say why. An unapproved template
 *                                                 name is rejected by Meta with a code nobody reads,
 *                                                 and the owner is left thinking the broadcast ran.
 *
 * Pure, so the selection is provable without Meta.
 */

/** The variable-free, industry-neutral template every account can fall back to. */
export const GENERIC_WEEKLY_TEMPLATE = 'nobogent_weekly_checkin_v2';

/**
 * Candidate templates per industry, most specific first.
 *
 * These names are the ones an account would have approved if it wanted a tailored check-in; nothing is
 * invented at send time, and a name that is not in the approved list is simply skipped.
 */
export const INDUSTRY_WEEKLY_TEMPLATES: Record<string, string[]> = {
  real_estate: ['nobogent_weekly_property_checkin', 'nobogent_weekly_listings_checkin'],
  education: ['nobogent_weekly_course_checkin', 'nobogent_weekly_batch_checkin'],
  immigration: ['nobogent_weekly_consult_checkin', 'nobogent_weekly_case_checkin'],
};

/**
 * Normalise whatever the profile calls the industry into one of the keys above.
 *
 * Mirrors the vocabulary map in lib/automation/industry.ts, including its rule: anything unrecognised
 * (including an empty industry) is NOT treated as real estate.
 */
export function industryKeyFor(industry?: string | null): string {
  const key = String(industry || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return 'generic';
  if (/(real.?estate|realty|propert|infra|homes|builder|land|plot)/.test(key)) return 'real_estate';
  if (/(educat|academy|school|college|course|training|film|institute|coaching)/.test(key)) return 'education';
  if (/(immigrat|visa|consult|abroad|pr\b)/.test(key)) return 'immigration';
  return 'generic';
}

export interface WeeklyTemplateChoice {
  /** The template to send, or null when nothing usable is approved (do not send). */
  template: string | null;
  /** 'industry' when a tailored template was used, 'generic' otherwise. */
  source: 'industry' | 'generic' | 'none';
  /** Plain language, for the cron log and for anyone asking why a lead got that message. */
  reason: string;
}

/**
 * Choose the check-in template for one account.
 *
 * `approved` is the list of template names Meta currently has APPROVED on that account's number. Only
 * names in that list are considered: an assistant that "knows" the right template name but has not
 * checked approval is how a broadcast silently fails for every lead in the account.
 */
export function chooseWeeklyTemplate(input: {
  industry?: string | null;
  approved: string[];
}): WeeklyTemplateChoice {
  const approved = new Set((input.approved || []).map((name) => String(name).trim()));
  const key = industryKeyFor(input.industry);
  const candidates = INDUSTRY_WEEKLY_TEMPLATES[key] ?? [];

  for (const candidate of candidates) {
    if (approved.has(candidate)) {
      return {
        template: candidate,
        source: 'industry',
        reason: `${key} check-in template "${candidate}" is approved on this number`,
      };
    }
  }

  if (approved.has(GENERIC_WEEKLY_TEMPLATE)) {
    return {
      template: GENERIC_WEEKLY_TEMPLATE,
      source: 'generic',
      reason:
        candidates.length
          ? `${key} has no approved tailored check-in (${candidates.join(', ')}), so the generic one is used`
          : `no tailored check-in exists for "${key}", so the generic one is used`,
    };
  }

  return {
    template: null,
    source: 'none',
    reason:
      `neither a tailored nor the generic check-in template is approved on this number. ` +
      `Submit ${GENERIC_WEEKLY_TEMPLATE} (or an industry template) and get it approved before the next Saturday.`,
  };
}

/**
 * The rendered copy for our own chat log.
 *
 * The delivered message is the approved template, so this must summarise what the customer actually
 * receives rather than interpolating a name the template no longer carries.
 */
export function weeklyCheckinPreview(template: string | null): string {
  if (!template) return '';
  if (template === GENERIC_WEEKLY_TEMPLATE) {
    return (
      'A quick weekly check-in from our team. We have been working on new things this week and would ' +
      'love to show you. Tap one of the buttons below and we will take it from there.'
    );
  }
  return `Weekly check-in (${template}) — the wording and buttons are whatever that template was approved with.`;
}
