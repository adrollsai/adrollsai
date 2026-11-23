/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows and provider payloads are untyped (stale generated types), matching utils/credits.ts. */
/**
 * CEO playbook + guardrails.
 *
 * THE PLAYBOOK
 * After onboarding the CEO decides, per tenant: the website shape, the call
 * script, the WhatsApp reply copy, and the three mandatory reply buttons. Those
 * decisions are frozen into one active `business_playbooks` row and every
 * send/call reads it, so behaviour is explainable and editable rather than
 * re-improvised per message.
 *
 * THE BUTTONS â€” IMPORTANT
 * The three reply buttons already work and must keep working. Their IDs are the
 * contract consumed by the inbound webhook handlers, so IDs never change:
 *   view_properties | talk_expert | book_appointment
 * Only the LABEL is context-driven ("View Courses" for an academy, "View
 * Properties" for a brokerage). Changing the id would silently break the button.
 *
 * GUARDRAILS
 * Autonomy spends real money and messages real people. canSpend()/recordSpend()
 * wrap the same caps enforced by the `can_spend` Postgres function.
 */

export interface ReplyButton {
  id: 'view_properties' | 'talk_expert' | 'book_appointment'
  label: string
}

export interface Playbook {
  id?: string
  version?: number
  status?: 'draft' | 'active' | 'archived'
  industry?: string | null
  positioning?: string | null
  website_spec: Record<string, unknown>
  call_script: Record<string, unknown>
  whatsapp_replies: Record<string, unknown>
  buttons: { cta?: ReplyButton[] }
  cadence: Record<string, unknown>
  /** Agent-owned daily schedule: what runs each day, when, on which channels. */
  daily_routine?: Record<string, unknown>
  /** First-draft recipes: how the agent composes creative / video / copy. */
  recipes?: { creative?: Record<string, unknown>; video?: Record<string, unknown>; copy?: Record<string, unknown> }
}

/**
 * Default label for the catalogue button, derived from the tenant's industry.
 * This is the ONLY industry-sensitive piece left, and it is a label â€” not
 * behaviour. The CEO playbook overrides it when it has authored one.
 */
export function defaultProductButtonLabel(industry?: string | null): string {
  const key = String(industry || '').toLowerCase()
  if (/educat|academy|film|school|institute|coach|training/.test(key)) return 'View Courses'
  if (/immigra|visa/.test(key)) return 'View Services'
  if (/health|clinic|hospital/.test(key)) return 'View Treatments'
  if (/real.?estate|propert|realt|infra|homes|realty/.test(key)) return 'View Properties'
  return 'View Offerings'
}

const BUTTON_DEFAULTS: Array<Omit<ReplyButton, 'label'> & { fallback: string }> = [
  { id: 'view_properties', fallback: 'View Offerings' },
  { id: 'talk_expert', fallback: 'Talk to Expert' },
  { id: 'book_appointment', fallback: 'Book Appointment' },
]

/**
 * The three mandatory reply buttons. Always returns exactly three, always with
 * the stable ids, so removing or reordering them cannot happen by accident.
 */
export function resolveReplyButtons(playbook: Partial<Playbook> | null, industry?: string | null): ReplyButton[] {
  const authored = playbook?.buttons?.cta
  const productLabel = defaultProductButtonLabel(playbook?.industry ?? industry)

  return BUTTON_DEFAULTS.map((def) => {
    const match = Array.isArray(authored) ? authored.find((b) => b?.id === def.id) : undefined
    const label =
      match?.label ||
      (def.id === 'view_properties' ? productLabel : def.fallback)
    return { id: def.id, label }
  })
}

export function emptyPlaybook(industry?: string | null): Playbook {
  return {
    industry: industry ?? null,
    website_spec: {},
    call_script: {},
    whatsapp_replies: {},
    buttons: { cta: resolveReplyButtons(null, industry) },
    cadence: {},
  }
}

/** Active playbook, or a safe default derived from profile context. */
export async function getActivePlaybook(
  supabaseAdmin: any,
  userId: string
): Promise<Playbook> {
  try {
    const { data } = await supabaseAdmin
      .from('business_playbooks')
      .select('id, version, status, industry, positioning, website_spec, call_script, whatsapp_replies, buttons, cadence, daily_routine, recipes, creative_directives')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()

    if (data) {
      return {
        ...data,
        buttons: { cta: resolveReplyButtons(data, data.industry) },
      } as Playbook
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('industry, mission_statement')
      .eq('id', userId)
      .maybeSingle()

    const base = emptyPlaybook(profile?.industry)
    if (profile?.mission_statement) base.positioning = profile.mission_statement
    return base
  } catch {
    return emptyPlaybook()
  }
}

/* ------------------------------------------------------------------ */
/* Guardrails                                                          */
/* ------------------------------------------------------------------ */

export interface SpendCheck {
  allowed: boolean
  reason?: string
  used?: number
  cap?: number
}

/** Ask the database whether this action is inside today's caps. */
export async function canSpend(
  supabaseAdmin: any,
  userId: string,
  kind: 'creative' | 'video' | 'call' | 'message',
  credits = 0,
  units = 1
): Promise<SpendCheck> {
  try {
    const { data, error } = await supabaseAdmin.rpc('can_spend', {
      p_user_id: userId,
      p_kind: kind,
      p_credits: credits,
      p_units: units,
    })
    if (error || !data) return { allowed: true } // fail open: never block delivery on a guard read
    return data as SpendCheck
  } catch {
    return { allowed: true }
  }
}

/** Record spend so tomorrow's cap reflects what actually happened. */
export async function recordSpend(
  supabaseAdmin: any,
  userId: string,
  kind: 'creative' | 'video' | 'call' | 'message',
  credits = 0,
  units = 1
): Promise<void> {
  try {
    await supabaseAdmin.from('automation_spend').insert({
      user_id: userId,
      kind,
      credits,
      units,
    })
  } catch {
    /* accounting must never break delivery */
  }
}

/** True when this tenant should have outbound redirected to the founder. */
export function tenantInTestMode(): boolean {
  return String(process.env.OUTBOUND_TEST_MODE || '').toLowerCase() === 'true'
}
