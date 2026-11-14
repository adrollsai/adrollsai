/**
 * The per-message policy for anything we send a LEAD.
 *
 * WHY THIS FILE EXISTS
 * `lib/agent/whatsapp-policy.ts` owns the send policy, but it also owns a
 * Supabase client, so nothing in it can be exercised without a database. The
 * rules below are the part that must be checkable offline — they are pure, and
 * `whatsapp-policy.ts` re-exports them so that file stays the documented home of
 * policy.
 *
 * THE RULES (a failure is BLOCKED and LOGGED, never silently dropped)
 *  1. There is a recipient we could actually dial.
 *  2. There is something to say.
 *  3. Exactly three reply buttons, with the stable ids the inbound webhook
 *     matches on: view_properties | talk_expert | book_appointment. A message
 *     without them is a bug, not a style choice.
 *  4. Outside the 24-hour service window a business-initiated message must name
 *     an approved template — Meta rejects free-form text there (error 131047),
 *     so sending it would only ever look like it worked.
 *  5. A tenant that is not a real-estate business never receives real-estate
 *     vocabulary. This is how a film academy stopped getting "property
 *     listings".
 */

export const LEAD_BUTTON_IDS = ['view_properties', 'talk_expert', 'book_appointment'] as const

export type LeadButtonId = (typeof LEAD_BUTTON_IDS)[number]

/**
 * Stems, not words: "propert" catches property/properties/propertie? and
 * "listing" catches listings/listing. Matched case-insensitively.
 */
export const REAL_ESTATE_VOCABULARY = ['propert', 'listing', 'rera', 'realtor'] as const

export interface LeadMessageButton {
  id: string
  label: string
}

export interface LeadMessageDraft {
  /** Digits or E.164 — whatever the channel will normalise. */
  to: string
  body: string
  buttons: LeadMessageButton[]
  /** Approved template name, used when the 24h window is shut. */
  template?: string | null
  /** The tenant's industry. Only real-estate industries may use its vocabulary. */
  industry?: string | null
  /** Whether the 24h service window is open for this lead. */
  windowOpen?: boolean
}

export type LeadPolicyCode =
  | 'ok'
  | 'no_recipient'
  | 'empty_body'
  | 'buttons_missing'
  | 'buttons_wrong_ids'
  | 'template_required'
  | 'industry_vocabulary'

export interface PolicyVerdict {
  allowed: boolean
  code: LeadPolicyCode
  /** Short, human reason — this is what gets logged against the blocked step. */
  reason?: string
}

/** True for a brokerage-type tenant, where the property words are the point. */
export function isRealEstateIndustry(industry?: string | null): boolean {
  return /real.?estate|propert|realt|realty|infra|homes|builder|land\b/i.test(String(industry || ''))
}

/** Which real-estate words appear in this text. Empty when the text is neutral. */
export function realEstateWordsIn(text?: string | null): string[] {
  const haystack = String(text || '').toLowerCase()
  if (!haystack) return []
  return REAL_ESTATE_VOCABULARY.filter((w) => haystack.includes(w))
}

/**
 * The gate every lead-facing send passes through. Returns a verdict rather than
 * throwing so the caller can record the reason and move on.
 */
export function checkLeadMessagePolicy(draft: LeadMessageDraft): PolicyVerdict {
  const to = String(draft?.to || '').replace(/\D/g, '')
  if (to.length < 10) {
    return {
      allowed: false,
      code: 'no_recipient',
      reason: `no dialable recipient (got "${String(draft?.to || '')}")`,
    }
  }

  const body = String(draft?.body || '').trim()
  if (!body) {
    return { allowed: false, code: 'empty_body', reason: 'the message body is empty' }
  }

  const buttons = Array.isArray(draft?.buttons) ? draft.buttons : []
  if (buttons.length === 0) {
    return {
      allowed: false,
      code: 'buttons_missing',
      reason: `no reply buttons — every lead message carries ${LEAD_BUTTON_IDS.join(' | ')}`,
    }
  }

  const ids = buttons.map((b) => String(b?.id || ''))
  const exact = ids.length === LEAD_BUTTON_IDS.length
    && LEAD_BUTTON_IDS.every((id, i) => ids[i] === id)
  if (!exact) {
    return {
      allowed: false,
      code: 'buttons_wrong_ids',
      reason: `reply button ids are [${ids.join(', ')}] but must be exactly [${LEAD_BUTTON_IDS.join(', ')}]`,
    }
  }

  const template = String(draft?.template || '').trim()
  if (draft?.windowOpen === false && !template) {
    return {
      allowed: false,
      code: 'template_required',
      reason: 'the 24h service window is closed and no approved template is named (Meta rejects free-form text: 131047)',
    }
  }

  if (!isRealEstateIndustry(draft?.industry)) {
    const labels = buttons.map((b) => String(b?.label || '')).join(' ')
    const found = realEstateWordsIn(`${body} ${labels}`)
    if (found.length > 0) {
      return {
        allowed: false,
        code: 'industry_vocabulary',
        reason: `industry-neutral tenant ("${String(draft?.industry || 'untagged')}") would receive real-estate vocabulary: ${found.join(', ')}`,
      }
    }
  }

  return { allowed: true, code: 'ok' }
}
