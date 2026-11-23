/**
 * First-draft recipes.
 *
 * These are the "templatisation" the product actually needs: PROMPT-LEVEL
 * guidance for how to make a sensible, attractive first draft — not a hardcoded
 * pipeline that dictates which model runs and in what order.
 *
 * The agent reads the recipe, has its own tools (image model, video model, TTS,
 * WhatsApp, publishing), and composes the artefact. Recipes are stored in the
 * playbook, so they can be edited in plain language and versioned like every
 * other decision.
 *
 * Design rule: every recipe must define a DEGRADED path. An agent composing from
 * scratch has more failure modes than a fixed pipeline, so each recipe says what
 * "still acceptable" looks like when the ideal isn't achievable — otherwise a bad
 * day produces nothing at all.
 */

export interface RecipeSet {
  creative: Record<string, unknown>
  video: Record<string, unknown>
  copy: Record<string, unknown>
}

export const DEFAULT_RECIPES: RecipeSet = {
  /**
   * A single daily poster + WhatsApp copy.
   *
   * The wording here is deliberately INDUSTRY-NEUTRAL. It used to say "listing
   * poster that a realtor would actually post", which meant a film academy's
   * brief carried real-estate vocabulary into every draft — the exact mistake
   * `lib/automation/industry.ts` exists to prevent. The industry-specific noun
   * comes from the vocabulary, not from here.
   */
  creative: {
    goal: 'one scroll-stopping poster the owner would genuinely post',
    canvas: {
      primary: '4:5',
      alternates: ['1:1', '9:16'],
      // The image model does not expose 4:5 (or most ratios) as an explicit enum.
      // Ask the provider for auto sizing and state the frame in the prompt instead.
      how: 'pass aspect_ratio/dimensions as auto and describe the frame in the prompt text',
    },
    must_include: [
      'the name of the thing being offered, legible at thumbnail size',
      'the price (or "Price on request" if absent)',
      'a real photo of the actual offering — never an invented one',
      'the brand mark or business name, tastefully small',
      'a headline that fits the field it will run in — 40 characters on a Meta headline, 30 on Google',
    ],
    layout: [
      'one clear focal point; the photo carries the frame, not the text',
      'headline in 2–5 words; supporting line optional',
      'generous margins — never fill edge to edge with text',
      'high contrast between text and its backdrop',
    ],
    avoid: [
      'stock-looking people who are not the presenter',
      'cluttered collages or more than one photo',
      'unverifiable claims, discounts or approvals not in the facts',
      'phone numbers baked into the image',
      // Copy tics are enforced in code by lib/ads/creative-specs.ts; this is the reminder that
      // arrives with the brief, before anything is written.
      'copy that reads as generated — "unlock the power", "reimagined", "say goodbye to", an em dash, ' +
        'three stacked negations (see the nobogent-ad-copy rule)',
    ],
    degraded_path:
      'If no usable photo exists, produce a clean typographic poster using the brand colour and the name of the offering — do NOT invent a building.',
  },

  /** A short vertical commercial, composed by the agent from its own tools. */
  video: {
    goal: 'a 15–30 second vertical clip that feels like real footage of the actual offering, not an AI demo',
    format: { aspect: '9:16', target_seconds: [15, 30], fps: 30 },
    structure: [
      'open on the strongest real visual of the thing being offered',
      'one presenter beat: who we are and what this is',
      'one proof beat: a specific, true detail from the facts',
      'close with a soft call to action — never a hard sell',
    ],
    audio: {
      voice: 'warm, conversational, natural Hinglish for India; plain English otherwise',
      pacing: 'about 2.2 words per second; leave a beat of silence at the end',
      music: 'subtle and low; the voice must stay the loudest element',
      rule: 'if an avatar or presenter is speaking, do NOT add a separate voiceover — only add TTS when the visuals are silent',
    },
    avoid: [
      'phone numbers or prices baked into frame',
      'invented amenities, possessions or approvals not in the facts',
      'rapid jump-cuts that hide the actual subject',
      'on-screen text that is unreadable on a phone',
    ],
    degraded_path:
      'If video generation fails or would look poor, deliver a 3–5 slide vertical "poster reel" from the still photos with the voiceover — a clean slideshow beats a broken render.',
  },

  /** Copy for WhatsApp + social. */
  copy: {
    goal: 'a message a real person would read to the end',
    length: { whatsapp: 'under 400 characters', social: 'under 300 characters' },
    structure: [
      'pick the ONE argument before writing, and be able to say which angle it is',
      'hook in the first line',
      'one concrete true benefit',
      'one clear call to action',
    ],
    language: 'natural Hinglish in Latin script for India; plain English otherwise — never mix scripts',
    channel_rules: {
      whatsapp: 'ALWAYS include the three reply buttons (View / Talk to Expert / Book) — never send a lead message without them',
    },
    avoid: [
      'shouting capitals',
      'emoji spam',
      'unverifiable superlatives',
      'any fact not supplied',
      // The enforced list lives in lib/ads/creative-specs.ts; this names the habits worth calling out
      // in the brief so the first draft is already close.
      'stock phrases ("unlock the power", "reimagined", "take it to the next level"), em dashes, ' +
        'contrast reveals ("it is not X, it is Y"), and three stacked negations',
    ],
    degraded_path:
      'If facts are thin, write a shorter honest message asking one qualifying question — never pad with invented detail.',
  },
}

/** Merge a stored/patched recipe set over the defaults. */
export function resolveRecipes(stored?: Partial<RecipeSet> | null): RecipeSet {
  return {
    creative: { ...DEFAULT_RECIPES.creative, ...(stored?.creative || {}) },
    video: { ...DEFAULT_RECIPES.video, ...(stored?.video || {}) },
    copy: { ...DEFAULT_RECIPES.copy, ...(stored?.copy || {}) },
  }
}
