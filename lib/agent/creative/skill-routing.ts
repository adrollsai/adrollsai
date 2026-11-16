/**
 * Which skills a task REQUIRES, decided from the request rather than from the model's memory.
 *
 * WHY THIS EXISTS
 * The owner's instruction was blunt: the relevant skills should be used by default, without anybody saying so.
 * "Use ui-ux-pro-max and scroll-craft for a website" is not something they should have to type. Relying on the
 * agent to notice a skill in a catalogue is exactly the failure mode where a website comes out generic while the
 * two skills that would have fixed it sit unread in the prompt.
 *
 * So two things happen, and they are deliberately different:
 *
 *   1. HERE, in the prompt: the required skills are NAMED for this turn, with the reason, and the agent is told to
 *      load them before acting. Cheap — names, not bodies — and it survives the model being lazy.
 *
 *   2. IN THE GENERATORS: the rules those skills describe are applied in code, so the output carries them whether
 *      or not a model read anything. `buildLandingPage` emits the house design system; see lib/site/design-system.ts
 *      for the mapping of rule to source.
 *
 * (2) is the one that actually guarantees the result. (1) exists so the agent also understands why, and can apply
 * the judgement the rules cannot encode.
 *
 * Every skill named here MUST resolve — a house skill from lib/agent/house-skills.ts or a vendored one from
 * lib/agent/skills-vendor. `verify:skills-default` fails on a name that resolves to nothing, because a mandate to
 * load a skill that does not exist is worse than no mandate.
 */

export interface SkillRequirement {
  /** Exact skill name, as `get_skill` expects it. */
  skill: string;
  /** Why this task needs it, in one line the agent can act on. */
  why: string;
}

interface SkillIntent {
  id: string;
  /** Case-insensitive signal for this kind of work. */
  signals: RegExp;
  requirements: SkillRequirement[];
}

const DESIGN_SKILLS: SkillRequirement[] = [
  {
    skill: 'ui-ux-pro-max',
    why: 'the design system: contrast that passes, 44px touch targets, a real type scale, labelled fields',
  },
  {
    skill: 'scroll-craft',
    why: 'the scroll structure: vary the anchor, one peak, a close that resolves, no em dashes in visible copy',
  },
];

const VIDEO_SKILLS: SkillRequirement[] = [
  { skill: 'video-shotcraft', why: 'shot design: what to point the camera at, and how each shot is framed' },
  { skill: 'nobogent-video-pipelines', why: 'the shape of the film: which beats, in what order, for this kind of video' },
];

/**
 * Ordered so the most specific intent wins. A request for "a video for the landing page" genuinely needs both,
 * and both are returned — the list is merged, not chosen from.
 */
export const SKILL_INTENTS: readonly SkillIntent[] = [
  {
    id: 'website',
    signals:
      /\b(websites?|web ?sites?|landing pages?|pages? for (the )?(offer|batch)|sites?|homepage|home page|one[- ]pager)\b/i,
    requirements: [...DESIGN_SKILLS],
  },
  {
    id: 'ad-creative',
    signals:
      /\b(ads?|adverts?|creatives?|posters?|banners?|thumbnails?|imagery|graphics?|diwali|festival offer|social posts?)\b/i,
    requirements: [
      { skill: 'meta-ads-creative', why: 'what makes a paid social creative convert: one message, offer in figures, one CTA' },
      { skill: 'banner-design', why: 'layout and type for a fixed-size poster or banner' },
    ],
  },
  {
    id: 'video',
    signals: /\b(videos?|reels?|shorts?|films?|promos?|b-?roll|montage|ad film|voice ?over|narrat\w+)\b/i,
    requirements: [...VIDEO_SKILLS],
  },
  {
    id: 'page-edit',
    signals: /\b(edit|change|update|replace|rewrite|fix)\b[^.]{0,40}\b(page|section|hero|headline|phone number|price)\b/i,
    requirements: [{ skill: 'nobogent-page-editing', why: 'edit one section surgically instead of re-rolling the whole page' }],
  },
];

/**
 * The skills this request requires, deduplicated, with the intents that asked for them.
 *
 * Returns `[]` for a request that matches no craft intent — a question about today's leads does not need a design
 * skill, and pretending otherwise would cost tokens and attention on every such turn.
 */
export function requiredSkillsFor(text: string): { requirements: SkillRequirement[]; intents: string[] } {
  const haystack = String(text ?? '').slice(-4000);
  const intents: string[] = [];
  const merged = new Map<string, SkillRequirement>();

  for (const intent of SKILL_INTENTS) {
    if (!intent.signals.test(haystack)) continue;
    intents.push(intent.id);
    for (const requirement of intent.requirements) {
      if (!merged.has(requirement.skill)) merged.set(requirement.skill, requirement);
    }
  }

  return { requirements: [...merged.values()], intents };
}

/**
 * The block the system prompt carries.
 *
 * Written as an instruction with a reason, not a suggestion, because the observed failure is an agent that reads a
 * catalogue entry and still decides to improvise.
 */
export function renderSkillMandate(requirements: SkillRequirement[]): string {
  if (!requirements.length) return '';
  const lines = requirements.map((requirement) => `- get_skill('${requirement.skill}') — ${requirement.why}.`);

  return [
    'SKILLS REQUIRED FOR THIS TASK — load them before you build anything. This is not optional, and nobody will',
    'remind you: if the request is for a website, a page, an ad, a poster or a film, the craft for it already',
    'exists here and improvising instead of loading it is how the output comes out generic.',
    ...lines,
    'Load them with get_skill FIRST, follow them over your own defaults, and if one contradicts something below,',
    'say which you followed and why. For a page or a website the design system is also applied in code, so what',
    'you write has to fit it rather than fight it.',
  ].join('\n');
}
