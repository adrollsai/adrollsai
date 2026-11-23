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
    // Documents belong here because the sandbox is the only thing that can READ one. A product
    // brochure, a fee sheet or a course PDF used to match nothing in this list, so the agent was
    // never handed `sandbox_bash_run` and truthfully answered that it could not open the file —
    // even though the sandbox is a root Linux VM where `pdftotext` takes ten seconds to install.
    signals:
      /\b(render|hyperframes|ffmpeg|video|mp4|reel|composition|gsap|animate|animation|matte|composite|montage|subtitles?|captions?|encode|sandbox|python|script|convert|resize|crop|clip|concat|frame|code|html|css|json|csv|zip|file|folder|terminal|bash|install|pdfs?|docx?|documents?|brochures?|pptx?|xlsx?|spreadsheet|ocr|extract|parse)\b/i,
  },
  media: {
    // `research` rides along because the house video doctrine is REFERENCE-FIRST: the agent is told
    // to find how the format is working before it designs, and it cannot do that without the web
    // tools. Pulling research in here is cheaper than a creative that was invented from nothing.
    with: ['sandbox', 'research'],
    // Plain "video" belongs here as well as in `sandbox`. It used to be only a
    // sandbox signal, so "make a 30 second video about our new batch" loaded the
    // rendering toolkit and NOT one video-generating tool — the agent could shell out
    // but had nothing to compose. A video request needs both, and `with` only ever
    // adds groups, so naming it here is safe.
    signals:
      /\b(images?|creatives?|posters?|banners?|thumbnails?|voice ?overs?|narrations?|tts|audio|music|grok|imagine|video|videos|reels?|shorts?|films?|promo|b-?roll|generate (an? )?(image|video|voice)|logos?|graphics?|designs?|diwali|bhai ?dooj|holi|festivals?|wishes|wish|ads?|advert\w*|campaign creatives?|social posts?|content|clips?)\b/i,
  },
  meta: {
    signals:
      /\b(meta|facebook ads?|fb ads?|instagram ads?|ad account|campaign|adset|ad set|ads?|budget|spend|cpl|cpa|ctr|impressions|reach|pixel|lead form|audience|targeting|boost)\b/i,
  },
  sites: {
    // `research` and `vision` ride along because a page request almost always arrives
    // with a reference: "make a landing page like this https://…", "same as our site",
    // "copy the style of this one". Without the web tools the agent cannot open that
    // URL, cannot screenshot it, and cannot read its design tokens — so it answers
    // "like this" from the URL's title alone and quietly invents the rest. Measured on
    // a real test: `sites` alone = 30 tools and no fetch, and the built page did not
    // resemble the reference at all.
    with: ['research', 'vision'],
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
    //
    // Audience groups and CRM writes belong here too: "make an audience of Diwali buyers",
    // "message that group", "move them to site visit" are follow-up work on leads, and the
    // tools for it were unreachable.
    //
    // The routine and the calling defaults belong here for the same reason: "make the routine
    // weekly", "stop calling new leads automatically" and "change the calling script" are all
    // changes to how the business behaves on its own, and without these words the turn loaded no
    // automation tool and the agent answered that it could not change them.
    signals:
      /\b(automations?|automated|automating|workflows?|flows?|triggers?|whenever|when a lead|sequences?|follow ?ups?|drips?|cadences?|audiences?|segments?|broadcasts?|campaigns?|move|stage|archiv\w+|tags?|crm|routines?|daily (?:routine|plan|brief|standup)|every day|each day|call(?:ing)? script|script (?:for|on) (?:the |my )?calls?|calling defaults?|calling voice|auto[- ]?call\w*|automatically|call(?:ing)? (?:new )?leads?|call (?:everyone|everybody|all|people|the list)|default voice|speaking voice|voice (?:agent|caller)|greeting)\b/i,
  },
  research: {
    signals:
      /\b(search|research|find out|look up|latest|news|price of|competitor|market|who is|what is|compare|trend|scrap(?:e|er|ing)?|harvest|crawl)\b/i,
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

  // BUILDING a page is heavier than reading one. A "landing page" question needs the
  // page tools and nothing else; "make / build / design me a page" needs somewhere to
  // write, render and screenshot it (the sandbox) and the ability to produce or fix
  // its imagery (media). Measured: with the sandbox the agent reverse-engineered a
  // reference site (screenshots + design tokens) and self-checked its own build at
  // desktop and phone widths; without it, the same request shipped blind.
  if (chosen.has('sites') && /\b(make|build|create|design|redesign|rebuild|write|draft|new)\b[\s\S]{0,40}\b(page|site|website|landing)\b|\b(page|site|website|landing)\b[\s\S]{0,40}\b(make|build|create|design|redesign|write|draft)\b/i.test(haystack)) {
    for (const extra of ['sandbox', 'media'] as ToolGroup[]) {
      if (!chosen.has(extra)) {
        chosen.add(extra);
        reasons.push(`${extra}: a page is being BUILT, not just read`);
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
