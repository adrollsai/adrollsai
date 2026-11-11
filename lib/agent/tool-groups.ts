/**
 * Tool groups, so a turn only pays for the tools it might use.
 *
 * The agent carried 65 tools on EVERY step: ~3.3k prompt tokens plus ~11.8k of
 * JSON schema, re-sent on each model call. That is latency and cost on every
 * single step, and a bigger catalogue also means more chance of reaching for the
 * wrong tool.
 *
 * Most turns need a small slice. A "make me a Bhai Dooj image" turn has no use
 * for the Meta ads suite, and a "how many calls today" turn has no use for
 * Grok video. So groups are selected from the conversation, and `core` is always
 * present so the basics never disappear.
 */

export type ToolGroup =
  | 'core'
  | 'sandbox'
  | 'media'
  | 'meta'
  | 'sites'
  | 'publishing'
  | 'recipes'
  | 'reporting'
  | 'automation'
  | 'research'
  | 'vision'
  | 'ops';

interface GroupRule {
  /** Additional groups to include when this one is selected. */
  with?: ToolGroup[];
  /** Case-insensitive phrases that indicate this capability is wanted. */
  signals: RegExp;
}

/**
 * Signal lists are deliberately generous: an unnecessary group costs tokens,
 * but a MISSING group costs a failed task, which is far worse.
 */
export const GROUP_RULES: Record<Exclude<ToolGroup, 'core'>, GroupRule> = {
  sandbox: {
    // Any real video work should be verifiable before it is delivered, so the
    // Gemini vision tools ride along with the sandbox.
    with: ['recipes', 'vision'],
    signals:
      /\b(render|hyperframes|ffmpeg|video|mp4|reel|composition|gsap|animate|animation|matte|composite|montage|subtitles?|captions?|encode|sandbox|python|script|convert|resize|crop|clip|concat|frame|code|html|css|json|csv|zip|file|folder|terminal|bash|install)\b/i,
  },
  media: {
    with: ['sandbox'],
    signals:
      /\b(images?|creatives?|posters?|banners?|thumbnails?|voice ?overs?|narrations?|tts|audio|music|grok|imagine|video clips?|b-?roll|generate (an? )?(image|video|voice)|logos?|graphics?|designs?|diwali|bhai ?dooj|holi|festivals?|wishes|wish)\b/i,
  },
  meta: {
    signals:
      /\b(meta|facebook ads?|fb ads?|instagram ads?|ad account|campaign|adset|ad set|ads?|budget|spend|cpl|cpa|ctr|impressions|reach|pixel|lead form|audience|targeting|boost)\b/i,
  },
  sites: {
    signals:
      /\b(landing pages?|websites?|web ?pages?|slugs?|custom domains?|domains?|sites?|urls?|published pages?)\b/i,
  },
  publishing: {
    signals:
      /\b(posts?|posting|publish|sharing|shares?|uploads?|broadcasts?|instagram|facebook page|linkedin|social|feeds?|reel posts?)\b/i,
  },
  reporting: {
    signals:
      /\b(how many|counts?|reports?|reporting|analytics|stats|statistics|summar(?:y|ies|ise|ize)|lead|leads|calls?|conversations?|today|yesterday|this week|this month|last \d+ days|funnels?|performance|what did|transcripts?|positive)\b/i,
  },
  automation: {
    // Plurals matter: "what automations are running" and "which flows exist" are the
    // commonest phrasings, and a singular-only pattern loaded no automation tools at
    // all, so the agent truthfully answered that it could not see them.
    signals:
      /\b(automations?|automated|automating|workflows?|flows?|triggers?|whenever|when a lead|sequences?|follow ?ups?|drips?|cadences?)\b/i,
  },
  research: {
    signals:
      /\b(search|research|find out|look up|latest|news|price of|competitor|market|who is|what is|compare|trend)\b/i,
  },
  vision: {
    signals:
      /\b(look at|see|analyse|analyze|describe|inspect|check) .{0,24}\b(video|image|photo|picture|clip|screenshot)\b|\b(attached|reference) (video|image|file)\b/i,
  },
  ops: {
    signals:
      /\b(remind|reminder|schedule|calendar|book(ing)?|notify|notification|alert|approve|approval|email me|delegate)\b/i,
  },
  recipes: {
    signals: /\b(recipe|template|behind the (head|subject)|rotoscope|matting)\b/i,
  },
};

/** Groups added when nothing else matches, so a vague turn still works. */
const DEFAULT_GROUPS: ToolGroup[] = ['sandbox', 'media', 'research', 'vision', 'ops'];

export interface GroupSelection {
  groups: ToolGroup[];
  /** Why each group was chosen — surfaced for debugging and the audit script. */
  reasons: string[];
}

/**
 * Pick groups from the recent conversation.
 *
 * Uses the last few messages, not just the latest, because a follow-up like
 * "and then post it" needs the context of what "it" was.
 */
export function selectToolGroups(text: string): GroupSelection {
  const haystack = (text || '').slice(-4000);
  const chosen = new Set<ToolGroup>(['core']);
  const reasons: string[] = [];

  for (const [group, rule] of Object.entries(GROUP_RULES) as [ToolGroup, GroupRule][]) {
    if (!rule.signals.test(haystack)) continue;
    if (!chosen.has(group)) {
      chosen.add(group);
      reasons.push(`${group}: matched its signals`);
    }
    for (const dep of rule.with || []) {
      if (!chosen.has(dep)) {
        chosen.add(dep);
        reasons.push(`${dep}: pulled in by ${group}`);
      }
    }
  }

  // Only the always-on groups matched: the request is vague, so give a usable
  // working set rather than a stripped-down agent that cannot act.
  if (chosen.size === 1) {
    for (const g of DEFAULT_GROUPS) {
      if (!chosen.has(g)) {
        chosen.add(g);
        reasons.push(`${g}: default set (no strong signal)`);
      }
    }
  }

  return { groups: [...chosen], reasons };
}

/** Every group, for endpoints that must expose the whole catalogue. */
export const ALL_GROUPS: ToolGroup[] = [
  'core',
  'sandbox',
  'media',
  'meta',
  'sites',
  'publishing',
  'recipes',
  'reporting',
  'automation',
  'research',
  'vision',
  'ops',
];
