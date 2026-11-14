/* eslint-disable @typescript-eslint/no-explicit-any --
 * Supabase rows and provider payloads are untyped (generated database.types.ts
 * is stale), matching the convention in utils/credits.ts and utils/voice-helper.ts.
 *//**
 * Shared scripting rules for AI-generated marketing artefacts.
 *
 * WHY THIS EXISTS
 * The video script and the daily creative's WhatsApp copy were produced by two
 * unrelated prompts: the video used a loose "luxury commercial director" brief
 * (which asked for Hinglish), while the creative used an English Hormozi
 * HOOK→OFFER→VALUE→URGENCY→CTA brief. The same tenant therefore received two
 * different brand voices from two systems that never saw each other.
 *
 * Everything brand-facing now derives its facts, language and factual guard from
 * here.
 */

/** ~2.2 spoken words per second is a reliable TTS pacing ratio. */
import { industryVocabulary } from '@/lib/automation/industry'

export const WORDS_PER_SECOND = 2.2

export function dialogueBudgetWords(durationSeconds: number): number {
  return Math.max(8, Math.round(durationSeconds * WORDS_PER_SECOND))
}

export interface FittedDialogue {
  text: string
  words: number
  budgetWords: number
  trimmed: boolean
}

/**
 * Trim a script to a spoken-word budget, cutting at a sentence boundary where
 * possible.
 *
 * Why this matters: `dialogue` is one continuous string but the video is stitched
 * from independently generated clips. A voiceover longer than the stitched video
 * gets cut off mid-word by the muxer; nothing else reconciles the two. Under
 * budget is safe (a little trailing silence), over budget is not.
 */
export function fitDialogue(raw: string, budgetWords: number): FittedDialogue {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!clean) return { text: '', words: 0, budgetWords, trimmed: false }

  const allWords = clean.split(' ').filter(Boolean)
  if (allWords.length <= budgetWords) {
    return { text: clean, words: allWords.length, budgetWords, trimmed: false }
  }

  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean]
  const kept: string[] = []
  let count = 0
  for (const sentence of sentences) {
    const n = sentence.trim().split(' ').filter(Boolean).length
    if (count + n > budgetWords) break
    kept.push(sentence.trim())
    count += n
  }

  let text = kept.join(' ').trim()
  if (!text) text = allWords.slice(0, budgetWords).join(' ')

  return {
    text,
    words: text.split(' ').filter(Boolean).length,
    budgetWords,
    trimmed: true,
  }
}

/**
 * Hard rules appended to every brand-facing generation prompt. The factual guard
 * exists because Indian real-estate advertising is regulated: inventing an
 * amenity, a possession date or an approval is a RERA exposure, and the previous
 * prompts only forbade mentioning phone numbers.
 */
export const BRAND_STYLE_GUARD = `HARD RULES (must follow exactly):
- Use ONLY the facts stated above. Never invent amenities, carpet area, floor, facing, approvals, possession dates, offers, discounts or a RERA number.
- If a fact is not given, do not imply it, and do not hedge with "probably" or "likely".
- Never include phone numbers, and never state a price that is not listed above.
- No unverifiable superlatives such as "#1", "best in city", "guaranteed returns".
- Language: natural conversational Hinglish (Hindi-English code-mix written in Latin script) for India-based listings; plain English otherwise. Do not mix scripts.
- Tone: confident, warm and premium. Never shouty, never discount-led.`

/** Variant for social captions, where a single contact line IS wanted. */
export const BRAND_STYLE_GUARD_WITH_CONTACT = BRAND_STYLE_GUARD.replace(
  '- Never include phone numbers, and never state a price that is not listed above.',
  '- You may end with the single contact line supplied above; add no other phone number. Never state a price that is not listed above.'
)

/**
 * Industry-aware factual guard. Replaces hardcoded real-estate wording
 * ("amenities, carpet area, RERA") with the domain rule for this tenant's
 * industry, so a film academy is never told to avoid inventing carpet area.
 */
export function brandStyleGuard(
  industry?: string | null,
  opts: { allowContact?: boolean } = {}
): string {
  const vocab = industryVocabulary(industry)
  const contactRule = opts.allowContact
    ? '- You may end with the single contact line supplied above; add no other phone number.'
    : '- Never include phone numbers.'

  return `HARD RULES (must follow exactly):
- Use ONLY the facts stated above. ${vocab.guardDomainLine}
- If a fact is not given, do not imply it, and do not hedge with "probably" or "likely".
${contactRule}
- Never state a price that is not listed above.
- No unverifiable superlatives such as "#1", "best in city", "guaranteed returns".
- Language: natural conversational Hinglish (Hindi-English code-mix written in Latin script) for India-based businesses; plain English otherwise. Do not mix scripts.
- Tone: confident, warm and premium. Never shouty, never discount-led.`
}
/** Facts block shared by the video script and the creative caption. */
export function buildScriptFacts(profile: any, property: any): string {
  const lines: string[] = []
  const business = String(profile?.business_name || '').trim()
  if (business) lines.push(`Business: ${business}`)

  const positioning = String(profile?.mission_statement || profile?.business_info || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (positioning) lines.push(`Positioning: ${positioning.slice(0, 200)}`)

  const tenantBrief = String(profile?.custom_prompt || '').replace(/\s+/g, ' ').trim()
  if (tenantBrief) lines.push(`Brand voice preference: ${tenantBrief.slice(0, 160)}`)

  const vocab = industryVocabulary(profile?.industry)
  const productLabel = vocab.productNoun.charAt(0).toUpperCase() + vocab.productNoun.slice(1)
  if (property?.title) lines.push(`${productLabel}: ${String(property.title).trim()}`)
  if (property?.property_type) lines.push(`${vocab.typeLabel}: ${String(property.property_type).trim()}`)
  if (property?.address) lines.push(`Location: ${String(property.address).replace(/\s+/g, ' ').trim()}`)
  if (property?.price) lines.push(`Price: ${String(property.price).trim()}`)

  // Configurations is stored as a JSON string (e.g. BHK mixes) — surface it raw
  // and short, since it is the most quoted fact in Indian property ads.
  if (property?.configurations) {
    const cfg = typeof property.configurations === 'string'
      ? property.configurations
      : JSON.stringify(property.configurations)
    const short = cfg.replace(/[{}\[\]"]/g, ' ').replace(/\s+/g, ' ').trim()
    if (short && short.length > 2) lines.push(`Configurations: ${short.slice(0, 160)}`)
  }

  if (property?.rera_number) lines.push(`RERA: ${String(property.rera_number).trim()}`)

  const description = String(property?.description || '').replace(/\s+/g, ' ').trim()
  if (description) lines.push(`Description: ${description.slice(0, 400)}`)

  return lines.join('\n')
}
