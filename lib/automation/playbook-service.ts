/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows and provider payloads are untyped (stale generated types), matching utils/credits.ts. */
/**
 * Playbook service — versioned, invariant-enforcing writes.
 *
 * HOW A USER CHANGES HOW THE AGENT WORKS (the whole point of this file)
 * The user never edits config. They say it in chat:
 *     "stop sending videos on Sundays, warmer tone, and call me Sir in calls"
 * The CEO turns that sentence into a STRUCTURED PATCH, shows the diff, and on
 * confirmation calls applyPlaybookPatch(). So natural language is the only user
 * interface; the patch is the machine contract.
 *
 * INVARIANTS (enforced here, not by convention)
 *  1. Exactly three reply buttons always exist, with stable ids. A patch may
 *     relabel them but can never remove, reorder away or re-id them — those ids
 *     are what the inbound webhook handlers match on.
 *  2. Only allowlisted sections can be written.
 *  3. Every write is a new version; the previous active row is archived, so
 *     history is never lost and behaviour is always explainable.
 *  4. If the write fails, the previous version is reactivated.
 */

import { resolveReplyButtons, type Playbook, type ReplyButton } from '@/lib/automation/ceo'

/** Sections the CEO/user may author. Anything else is rejected. */
export const PATCHABLE_SECTIONS = [
  'positioning',
  'industry',
  'website_spec',
  'call_script',
  'whatsapp_replies',
  'buttons',
  'cadence',
  'daily_routine', // what the agent does each day, and when
  'recipes',       // how to make a good FIRST draft (creative / video / copy)
] as const

export type PatchableSection = (typeof PATCHABLE_SECTIONS)[number]

export interface PlaybookPatch {
  section: PatchableSection
  value: unknown
}

export interface PatchResult {
  ok: boolean
  error?: string
  version?: number
  changed?: string[]
  buttons?: ReplyButton[]
}

/** Stable ids — the contract with the inbound webhook handlers. */
const BUTTON_IDS = ['view_properties', 'talk_expert', 'book_appointment'] as const

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Deep merge, so a patch only changes the keys it names. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as T) ?? base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

/**
 * Force the button invariant onto whatever the patch produced. Unknown buttons
 * are dropped, missing ones are re-defaulted, ids are never rewritten.
 */
export function enforceButtonInvariant(candidate: unknown, industry?: string | null): ReplyButton[] {
  const authored = isPlainObject(candidate) && Array.isArray((candidate as any).cta)
    ? (candidate as any).cta
    : Array.isArray(candidate)
      ? (candidate as any[])
      : []

  return BUTTON_IDS.map((id) => {
    const match = authored.find((b: any) => b && b.id === id)
    const label = typeof match?.label === 'string' ? match.label.trim() : ''
    return { id: id as ReplyButton['id'], label }
  }).map((b, i) => {
    if (b.label) return b
    const defaults = resolveReplyButtons(null, industry)
    return defaults[i]
  })
}

/**
 * Build the next playbook state from the active one plus a patch. Pure — no I/O,
 * so this is what the tests exercise.
 */
export function buildNextPlaybook(
  current: Playbook | null,
  patch: PlaybookPatch
): { ok: boolean; error?: string; next?: Playbook; changed?: string[] } {
  if (!PATCHABLE_SECTIONS.includes(patch.section)) {
    return { ok: false, error: `section '${patch.section}' is not patchable` }
  }
  if (patch.value === undefined || patch.value === null) {
    return { ok: false, error: 'patch value is empty' }
  }

  const base: Playbook = current ?? {
    website_spec: {},
    call_script: {},
    whatsapp_replies: {},
    buttons: { cta: resolveReplyButtons(null, null) },
    cadence: {},
  }

  const next: any = { ...base }
  const before = (base as any)[patch.section]
  next[patch.section] = isPlainObject(before) || isPlainObject(patch.value)
    ? deepMerge(before ?? {}, patch.value)
    : patch.value

  // Invariant: the three buttons always survive, with stable ids.
  if (patch.section === 'buttons' || true) {
    next.buttons = {
      ...(isPlainObject(next.buttons) ? next.buttons : {}),
      cta: enforceButtonInvariant(next.buttons, next.industry ?? base.industry),
    }
  }

  return { ok: true, next: next as Playbook, changed: [patch.section] }
}

/**
 * Persist a new active version. Archives the previous one and reactivates it if
 * the write fails, so a tenant is never left without an active playbook.
 */
export async function applyPlaybookPatch(
  supabaseAdmin: any,
  userId: string,
  patch: PlaybookPatch,
  opts: { authoredBy?: 'ceo' | 'user'; note?: string; current?: Playbook | null } = {}
): Promise<PatchResult> {
  const current = opts.current ?? await loadActive(supabaseAdmin, userId)
  const built = buildNextPlaybook(current, patch)
  if (!built.ok || !built.next) return { ok: false, error: built.error }

  const nextVersion = Number(current?.version ?? 0) + 1
  const previousId = (current as any)?.id as string | undefined

  // 1. Archive the current row FIRST — the partial unique index allows only one
  //    active playbook per tenant, so the new one cannot be inserted before this.
  if (previousId) {
    const { error: archErr } = await supabaseAdmin
      .from('business_playbooks')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', previousId)
    if (archErr) return { ok: false, error: `archive failed: ${archErr.message}` }
  }

  const row = {
    user_id: userId,
    version: nextVersion,
    status: 'active',
    industry: built.next.industry ?? null,
    positioning: built.next.positioning ?? null,
    website_spec: built.next.website_spec ?? {},
    call_script: built.next.call_script ?? {},
    whatsapp_replies: built.next.whatsapp_replies ?? {},
    buttons: built.next.buttons ?? {},
    cadence: built.next.cadence ?? {},
    daily_routine: (built.next as any).daily_routine ?? {},
    recipes: (built.next as any).recipes ?? {},
    authored_by: opts.authoredBy ?? 'ceo',
    notes: opts.note ?? null,
    updated_at: new Date().toISOString(),
  }

  const { error: insErr } = await supabaseAdmin.from('business_playbooks').insert(row)

  if (insErr) {
    // Restore the previous version so behaviour does not silently reset.
    if (previousId) {
      await supabaseAdmin
        .from('business_playbooks')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', previousId)
    }
    return { ok: false, error: `insert failed: ${insErr.message}` }
  }

  return {
    ok: true,
    version: nextVersion,
    changed: built.changed,
    buttons: (built.next.buttons as any)?.cta,
  }
}

async function loadActive(supabaseAdmin: any, userId: string): Promise<Playbook | null> {
  try {
    const { data } = await supabaseAdmin
      .from('business_playbooks')
      .select('id, version, status, industry, positioning, website_spec, call_script, whatsapp_replies, buttons, cadence, daily_routine, recipes')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()
    return (data as Playbook) ?? null
  } catch {
    return null
  }
}

/** Human-readable diff for the confirmation step in chat. */
export function describePatch(patch: PlaybookPatch): string {
  const json = JSON.stringify(patch.value, null, 1)
  const clipped = json.length > 400 ? json.slice(0, 400) + '…' : json
  return `${patch.section} →\n${clipped}`
}
