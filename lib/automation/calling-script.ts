/**
 * The calling script the voice agent uses — and the default it falls back to.
 *
 * WHY
 * The call prompt used to be one long literal inside `app/api/voice/twiml`, so
 * every tenant got the same brokerage-flavoured script and a film academy heard
 * about "site visits". A per-tenant / per-campaign script lives in the playbook
 * (`call_script.script`, authored through `applyPlaybookPatch`) and on the
 * campaign (`campaigns.custom_prompt`); this module resolves which one wins and
 * ships an industry-neutral default for when neither is set.
 *
 * Precedence, most specific first:
 *   1. campaign script        (this campaign only)
 *   2. tenant playbook script (this business)
 *   3. the caller's own dynamic default (the twiml route builds one from context)
 *   4. DEFAULT_CALLING_SCRIPT (shipped, industry-neutral)
 *
 * Placeholders are the entire vocabulary: {{name}}, {{business}}, {{product}},
 * {{products}}, {{catalogue}} — the same set the WhatsApp journey uses.
 */

import { industryVocabulary } from '@/lib/automation/industry'

/**
 * Where did this lead come from? This decides the first thing the bot says about the enquiry.
 *
 * THE BUG THIS EXISTS FOR
 * The voice prompt used to decide this inline with `source.includes('whatsapp') || custom_fields.meta_ad_origin`,
 * and every Meta lead-form submission carries `meta_ad_origin`. So a lead who filled a
 * Facebook/Instagram instant form — and had never sent a WhatsApp message in their life — was
 * greeted with "aapne WhatsApp par inquiry start kiya tha". Procolor's leads Varun and KARTIK
 * were exactly that: source "Facebook Ads", meta_ad_origin present, no WhatsApp thread at all.
 * The bot opened by describing a conversation that never happened.
 *
 * Precedence, and why:
 *   1. notes    — the owner wrote something about this specific lead; most specific wins.
 *   2. whatsapp — an actual WhatsApp thread (real messages or a WhatsApp source). This outranks
 *                 the ad because the lead really did message, even if an ad brought them in.
 *   3. meta-ad  — a Meta ad/form submission. Say "the ad you saw", never WhatsApp.
 *   4. ad       — anything else that isn't WhatsApp (a CSV import, a portal, a referral).
 */
export type LeadOrigin = 'notes' | 'whatsapp' | 'meta-ad' | 'ad'

export function classifyLeadOrigin(input: {
  source?: string | null
  /** `custom_fields.meta_ad_origin` — set by a Meta instant-form submission. */
  hasMetaAdOrigin?: boolean
  /** True only when there is an actual WhatsApp conversation to refer to. */
  hasWhatsAppThread?: boolean
  hasNotes?: boolean
}): LeadOrigin {
  if (input.hasNotes) return 'notes'
  const source = String(input.source || '').toLowerCase()
  if (source.includes('whatsapp') || input.hasWhatsAppThread) return 'whatsapp'
  if (input.hasMetaAdOrigin || /facebook|instagram|meta|\bfb\b/.test(source)) return 'meta-ad'
  return 'ad'
}

/**
 * Shipped default. Deliberately industry-neutral: no property, listing, course or
 * visa assumptions, no invented facts, and an explicit "stop when asked" rule so
 * the phone channel honours an opt-out the same way WhatsApp does.
 */
export const DEFAULT_CALLING_SCRIPT = `You are a professional, helpful outbound calling assistant calling on behalf of {{business}}.
You are speaking to {{name}}.

YOUR GOAL
Understand what {{name}} asked about, answer it honestly from the business profile, and offer one clear next step — a callback, an appointment, or more detail on our {{products}}.

CRITICAL RULES
1. Only use facts from the business profile, the catalogue and this lead's own history. Never invent prices, dates, approvals, fees, guarantees or availability.
2. Be brief. Keep every answer under 50 spoken words and never read out a list.
3. Speak in the lead's language. If they switch language, switch with them immediately and stay natural.
4. Never claim to be a human being. If they ask to speak to a person, say a colleague will call them back shortly, take the best number/time, and close politely.
5. If the lead says they are not interested, that they want no more calls, or asks to stop — acknowledge once, end the call, and treat it as an opt-out. Do not attempt to persuade.
6. If you do not know something, say you do not know and offer a colleague's follow-up instead of guessing.
7. If you reach voicemail or an answering machine, end the call without leaving a message.`

export interface ResolvedCallingScript {
  script: string
  firstMessage: string
  /** Which layer supplied it — logged, so a customer can be told why the bot said that. */
  source: 'campaign' | 'playbook' | 'fallback' | 'default'
}

export interface ResolveCallingScriptInput {
  /** `campaigns.custom_prompt` — per-campaign text the owner typed. */
  campaignScript?: string | null
  /** The active playbook row; `call_script.script` is the tenant-level text. */
  playbook?: { call_script?: Record<string, unknown> | null } | null
  industry?: string | null
  leadName?: string | null
  businessName?: string | null
  /** The caller's dynamically generated default, if it has a richer one. */
  fallbackScript?: string | null
}

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Fill the placeholders. Unknown placeholders are left alone, never mangled. */
export function renderCallingScript(
  script: string,
  ctx: { leadName?: string | null; businessName?: string | null; industry?: string | null } = {}
): string {
  const vocab = industryVocabulary(ctx.industry)
  const name = clean(ctx.leadName) || 'the lead'
  const business = clean(ctx.businessName) || 'the business'
  return String(script || '')
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*business\s*\}\}/gi, business)
    .replace(/\{\{\s*product\s*\}\}/gi, vocab.productNoun)
    .replace(/\{\{\s*products\s*\}\}/gi, vocab.productNounPlural)
    .replace(/\{\{\s*catalogue\s*\}\}/gi, vocab.collectionHeading)
    .trim()
}

/**
 * Resolve the script for one call. Every layer is optional, so this cannot fail:
 * the worst case is the shipped default, which is always safe to speak.
 */
export function resolveCallingScript(input: ResolveCallingScriptInput = {}): ResolvedCallingScript {
  const campaign = clean(input.campaignScript)
  const authored = input.playbook && typeof input.playbook.call_script === 'object'
    ? clean((input.playbook.call_script as Record<string, unknown>)?.script)
    : ''
  const fallback = clean(input.fallbackScript)

  const [script, source]: [string, ResolvedCallingScript['source']] = campaign
    ? [campaign, 'campaign']
    : authored
      ? [authored, 'playbook']
      : fallback
        ? [fallback, 'fallback']
        : [DEFAULT_CALLING_SCRIPT, 'default']

  const authoredFirst =
    (input.playbook && typeof input.playbook.call_script === 'object'
      ? clean((input.playbook.call_script as Record<string, unknown>)?.firstMessage)
      : '') || ''

  const firstMessage = authoredFirst
    ? renderCallingScript(authoredFirst, input)
    : `Hi ${clean(input.leadName) || 'there'}! Am I speaking with the right person about your enquiry?`

  return {
    script: renderCallingScript(script, input),
    firstMessage,
    source,
  }
}

/**
 * A playbook patch that sets the tenant's own script, for
 * `applyPlaybookPatch(supabase, userId, patch)` — the owner says it in chat, the
 * CEO stores it here. Never write `business_playbooks` directly.
 */
export function callingScriptPatch(
  script: string,
  firstMessage?: string | null
): { section: 'call_script'; value: { script: string; firstMessage?: string } } {
  const value: { script: string; firstMessage?: string } = { script: String(script || '').trim() }
  const first = clean(firstMessage)
  if (first) value.firstMessage = first
  return { section: 'call_script', value }
}
