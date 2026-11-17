/**
 * The skill ROUTER: pick the skill that applies, instead of loading all of them.
 *
 * THE PROBLEM WITH "VENDOR EVERYTHING"
 * The OpenMontage repository the owner pointed at carries roughly 700 skill files. Loading
 * them into a turn is not an option: every description costs prompt tokens on EVERY step,
 * and a catalogue that large makes the model worse at choosing, not better. But not
 * shipping them at all throws away real knowledge.
 *
 * THE ANSWER IS A ROUTER, NOT A LIBRARY CARD
 *   - the prompt carries names and one-line descriptions (progressive disclosure)
 *   - `pick_skill` scores every available skill against the actual requirement and returns
 *     the best FEW, with the reason it chose each
 *   - `get_skill` then loads only the winner's body
 *
 * So a turn pays for one skill's instructions, not seven hundred.
 *
 * HOW THE SCORE WORKS, AND WHY IT IS DELIBERATELY SIMPLE
 * Token overlap between the requirement and the skill's name + description, with a small
 * phrase bonus. No embeddings, no model call: it is deterministic, instant, free, and it
 * can be tested — which matters more here than cleverness, because a router that is subtly
 * wrong sends the agent down the wrong path and nobody can see why. A requirement that
 * matches nothing returns nothing, and the agent falls back to its own judgement, which is
 * the honest outcome.
 *
 * PURE: no I/O, no clock, no network.
 */

export interface RoutableSkill {
  name: string;
  description: string;
  /** Where it came from: 'platform', 'vendor' or 'tenant'. Affects tie-breaking only. */
  source?: 'platform' | 'vendor' | 'tenant';
}

export interface SkillMatch {
  name: string;
  score: number;
  /** The words that matched, so the choice can be argued with. */
  matched: string[];
  source: string;
}

/** Words too common to mean anything when matching a requirement to a skill. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from', 'has', 'have',
  'how', 'i', 'in', 'is', 'it', 'me', 'my', 'need', 'of', 'on', 'or', 'our', 'please', 'so',
  'some', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to',
  'us', 'want', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
  'you', 'your', 'make', 'create', 'get', 'give', 'new', 'one', 'up', 'out', 'about', 'into',
  'should', 'would', 'could', 'like', 'just', 'also', 'more', 'any', 'all', 'help',
]);

/** Lowercase words of 3+ letters, minus the stop list. */
export function tokenise(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/**
 * Rank the skills that could apply to a requirement.
 *
 * Scoring, from strongest to weakest signal:
 *   - the skill's NAME appears in the requirement      +6 per token
 *   - a word appears in the DESCRIPTION                +2 per token
 *   - a two-word phrase from the description appears in the requirement  +3
 * Vendors are nudged down by 1 so a platform rule wins a tie: our own rules encode
 * invariants, and a third-party design opinion should not outrank them.
 */
export function rankSkills(
  requirement: string,
  skills: readonly RoutableSkill[],
  options: { limit?: number; minScore?: number } = {},
): SkillMatch[] {
  const limit = Math.max(1, Math.min(10, options.limit ?? 3));
  const minScore = options.minScore ?? 4;
  const requirementTokens = new Set(tokenise(requirement));
  const requirementText = String(requirement ?? '').toLowerCase();
  if (requirementTokens.size === 0) return [];

  const scored: SkillMatch[] = skills.map((skill) => {
    const nameTokens = new Set(tokenise(skill.name.replace(/[-_]/g, ' ')));
    const descriptionTokens = tokenise(skill.description);
    const matched = new Set<string>();
    let score = 0;

    for (const token of requirementTokens) {
      if (nameTokens.has(token)) {
        score += 6;
        matched.add(token);
      }
    }
    for (const token of descriptionTokens) {
      if (requirementTokens.has(token)) {
        score += 2;
        matched.add(token);
      }
    }

    // A two-word phrase lifted out of the description is a strong signal.
    const descriptionWords = tokenise(skill.description);
    for (let index = 0; index < descriptionWords.length - 1; index++) {
      const phrase = `${descriptionWords[index]} ${descriptionWords[index + 1]}`;
      if (phrase.length > 8 && requirementText.includes(phrase)) score += 3;
    }

    // THE VERB DECIDES THE TASK CLASS. "change the phone number on the landing page" is an EDIT, not a design job,
    // and a design skill will out-score the editing skill on the words "landing page" alone — so it gets picked and the
    // agent starts redesigning when it was asked to change one number. Likewise "review / critique / polish / audit"
    // is a review job, which belongs to a critique rubric rather than to a style guide.
    const EDIT_VERBS = /\b(change|update|edit|replace|rename|remove|swap|fix|correct)\b/i;
    const REVIEW_VERBS = /\b(review|critique|audit|polish|improve|assess|score|judge)\b/i;
    const haystack = `${skill.name} ${skill.description}`.toLowerCase();

    if (EDIT_VERBS.test(requirementText) && /edit/.test(skill.name.toLowerCase())) {
      score += 12;
    }
    if (REVIEW_VERBS.test(requirementText) && /(critique|review|audit|polish|craft)/.test(haystack)) {
      score += 12;
    }

    if (skill.source === 'vendor') score -= 1;

    return { name: skill.name, score, matched: [...matched].sort(), source: skill.source ?? 'unknown' };
  });

  return scored
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => (b.score === a.score ? a.name.localeCompare(b.name) : b.score - a.score))
    .slice(0, limit);
}

/** A sentence the agent can act on: the pick, why, and what to do next. */
export function describeRoute(requirement: string, matches: readonly SkillMatch[]): string {
  if (!matches.length) {
    return (
      `No skill matches "${String(requirement).slice(0, 80)}" closely enough. Proceed on your own judgement, ` +
      'and say which assumptions you made.'
    );
  }
  const [best, ...rest] = matches;
  const because = best.matched.length ? ` (matched: ${best.matched.slice(0, 6).join(', ')})` : '';
  return (
    `Load "${best.name}" first${because}.` +
    (rest.length ? ` Also relevant: ${rest.map((entry) => entry.name).join(', ')}.` : '') +
    ' Call get_skill with the ONE that applies and follow it; do not load several to be safe.'
  );
}
