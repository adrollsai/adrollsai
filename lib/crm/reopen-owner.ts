/**
 * What to do with a lead's OWNER when it re-enquires, and what the new owner may see.
 *
 * THE CASE THIS EXISTS FOR
 * A live client's lead "Gaurav" was Gunheer's. She called him, found he runs a YouTube channel rather
 * than buying, and put him in Lost/NI. The next day he re-enquired through Magicbricks — for a
 * DIFFERENT project (Vintage Greens, not The Medallion Aurum) — and came back owned by Shubha Baweja.
 *
 * That reassignment was not a bug: a person asking about a different project is new work, and routing
 * it to whoever is next in the queue is right. What was wrong is that nothing said so, and the new
 * agent inherited the previous agent's entire working history on that person.
 *
 * THE RULE TODAY (the owner's call, after the version above went wrong in a live account)
 *
 *   A lead that already has an owner KEEPS them, whatever project the new enquiry mentions. The
 *   distribution candidate is used only when the lead had no owner at all. Reopening is the same
 *   person enquiring again, and whoever knows that person keeps them; the reassignment was what
 *   handed one agent's history to another and stamped a follow-up in a name that never wrote one.
 *
 *   So nothing is reassigned and nothing is hidden: `reassigned` and `hidePreviousHistory` are always
 *   false on the owner-preserving path. `reopenCustomFields` still records that the lead reopened and
 *   where from, which is what the timeline and the reopen count read.
 */

/** Where the lead came from last time, as far as any handler can tell. */
export interface ReopenSourceContext {
  /** This enquiry's project/source label, e.g. "Vintage Greens". */
  nextSource: string | null | undefined;
  /** The lead's previous source label: `ad_name`, `form_name`, `source`, last reopen source. */
  previousSource: string | null | undefined;
}

/** Everything that decides how a reopen is handled. */
export interface ReopenDecisionInput extends ReopenSourceContext {
  /** The lead's current owner, or null. */
  previousOwner: string | null | undefined;
  /** Whoever the distribution engine picked for this enquiry. */
  candidate: string | null | undefined;
}

export interface ReopenDecision {
  /** The owner the lead must end up with. */
  owner: string | null;
  /** True when this enquiry took the lead off its previous owner. */
  reassigned: boolean;
  /** True when the new owner must not see history recorded before this point. */
  hidePreviousHistory: boolean;
  /** One line explaining the decision, for the log. */
  why: string;
}

/** Normalise a source label for comparison: case, punctuation and the portal prefix do not matter. */
function normSource(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    // "Magicbricks - Vintage Greens" and "Vintage Greens" are the same project.
    .replace(/^\s*(magicbricks|housing\.com|housing|99acres|facebook|meta)\s*[-–—:|]*\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Did this enquiry come in for a different project than the one on file?
 *
 * Unknown on either side means "cannot tell", which is treated as the SAME project: keeping an owner
 * is the conservative choice, and a wrongly-reassigned lead is worse than a lead that stayed with
 * someone who already knows the person.
 */
export function isDifferentProject(previousSource: string | null | undefined, nextSource: string | null | undefined): boolean {
  const before = normSource(previousSource);
  const after = normSource(nextSource);
  if (!before || !after) return false;
  return before !== after;
}

/** Resolve the owner, and whether the previous history must be hidden. */
export function decideReopenOwner(input: ReopenDecisionInput): ReopenDecision {
  const previousOwner = input.previousOwner || null;
  const candidate = input.candidate || null;

  // Nothing to preserve: a lead nobody owned simply gets the distribution candidate.
  if (!previousOwner) {
    return {
      owner: candidate,
      reassigned: false,
      hidePreviousHistory: false,
      why: candidate ? 'the lead had no owner, so it was assigned' : 'the lead had no owner and no candidate',
    };
  }

  /**
   * SAME OWNER, ALWAYS — the owner's rule, after watching it go wrong in a live account.
   *
   * A lead that was Shubha's came back through Magicbricks under a new project, was reassigned to Bhavdeep, and the
   * timeline recorded "Reassigned from the previous owner: a different project" plus a follow-up remark in Bhavdeep's
   * name that he never wrote. Reopening is the same person enquiring again: whoever knows that person keeps them,
   * whatever project the new enquiry mentions. Losing the owner on reopen loses the relationship the CRM exists to
   * protect, and hands one agent's history to another.
   *
   * So a lead that already has an owner keeps them, and `candidate` is only used when there was no owner at all.
   */
  return {
    owner: previousOwner,
    reassigned: false,
    hidePreviousHistory: false,
    why: isDifferentProject(input.previousSource, input.nextSource)
      ? 'a reopen keeps its previous owner even for a different project'
      : 'same project, so the lead kept its owner',
  };
}

/**
 * The reopen bookkeeping to merge into `custom_fields`.
 *
 * Every portal handler must record the same keys, or the CRM shows a different story depending on
 * which portal the lead came back through. Magicbricks and Housing recorded none of this, which is why
 * a lead that had re-enquired twice still displayed no reopen count.
 */
export function reopenCustomFields(input: {
  existing: Record<string, any>;
  nextSource: string | null | undefined;
  previousSource: string | null | undefined;
  now?: Date;
}): Record<string, any> {
  const nowIso = (input.now || new Date()).toISOString();
  const existing = input.existing || {};
  const previous = Array.isArray(existing.reopened_sources) && existing.reopened_sources.length > 0
    ? existing.reopened_sources
    : [input.previousSource].filter(Boolean);
  const label = String(input.nextSource || '').trim() || 'unknown source';

  return {
    ...existing,
    is_reopened: true,
    reopened_count: (Number(existing.reopened_count) || 0) + 1,
    reopened_sources: Array.from(new Set([...previous.map(String), label])),
    last_reopened_at: nowIso,
    last_reopened_source: label,
  };
}
