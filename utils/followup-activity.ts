/**
 * Follow-up activity accounting — the single source of truth for "how many follow-ups
 * did each rep log, and when".
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The Analytics page used to answer that question three different ways:
 *
 *   • Followup Board   → every lead_history row whose text mentioned "call"/"followup"
 *   • Action Report    → the same rows, but re-dated from whatever date happened to
 *                        appear in the description, then de-duplicated
 *   • Team matrix      → the raw row count again
 *
 * The Action Report's re-dating was the expensive bug. `parseActionDate()` grabbed the
 * first date-looking token anywhere in the description, and follow-ups written by the
 * offline fallback end with "Next Action: Call on 21/10/2026, 15:40:00". So the *next
 * action* date was read as the *time the action happened*: any follow-up whose agent
 * typed a past next-action date silently vanished from today's numbers. A lead filed as
 * "Next Action: Call on 11/17/2026" was read as month 17 → JS rolled it into May 2027.
 * That is how a rep who logged 9 follow-ups was told he logged 7.
 *
 * The rules implemented here:
 *
 *   1. A lead_history row happened at `created_at`. Full stop. Its description is never
 *      consulted for timing — it is only read to classify the action.
 *   2. Lead notes / custom_fields are a *gap-fill* only: they are parsed for a lead that
 *      has no lead_history row in the range. Legacy and imported leads have history only
 *      in their notes, but a lead that has both must not be counted twice.
 *   3. A note block's timestamp may only come from its leading "[...]" header, and only
 *      if it parses to a plausible real date.
 *   4. Attribution needs a name. An empty name matches nobody, and then falls back to the
 *      lead's assignee — it never silently picks "whoever is first in the list", which is
 *      what happened when `repName` was '' and `name.includes('')` returned true.
 *
 * Everything here is pure so it can be exercised without a browser or a database.
 */

export type FollowupCategory =
  | 'calls'
  | 'dnp'
  | 'visits'
  | 'revisits'
  | 'closing_meetings'
  | 'home_meetings'
  | 'whatsapp'

export const FOLLOWUP_CATEGORIES: FollowupCategory[] = [
  'calls',
  'dnp',
  'visits',
  'revisits',
  'closing_meetings',
  'home_meetings',
  'whatsapp',
]

/** The CRM stamps its note headers and action logs in Indian Standard Time. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/**
 * Two follow-ups logged on the same lead inside this window are the same follow-up.
 *
 * Deliberately short. It has to absorb the duplicate writes we actually see in production —
 * a second row landing 0–2 seconds after the first, when the client's offline fallback raced
 * the API — and the "call initiated" remark the CRM writes ~30s before the follow-up it
 * belongs to. It must not swallow a genuine second call on the same lead, which is why the
 * old 30-minute window was too blunt to reuse here.
 */
export const DEFAULT_DEDUPE_WINDOW_MS = 5 * 60 * 1000

/**
 * Next-action types that represent a booking rather than a callback.
 *
 * Saving one of these must stamp `leads.booked_time`. The list previously lived in the CRM
 * route as `['Site Visit','Meeting','Appointment']` — none of which the follow-up modal can
 * actually send (`NEXT_ACTION_TYPES` offers Call / Visit / Revisit / Closing Meeting / Home
 * Meeting). So the booking branch was unreachable: an agent could write "meet at 9pm",
 * choose the closest type, and the lead would still be saved as an unbooked call with no
 * `booked_time`, invisible in every appointment view.
 */
export const BOOKABLE_NEXT_ACTION_TYPES = [
  'site visit',
  'visit',
  'revisit',
  'meeting',
  'appointment',
  'closing meeting',
  'home meeting',
]

export function isBookableActionType(value?: string | null): boolean {
  return BOOKABLE_NEXT_ACTION_TYPES.includes(String(value || '').toLowerCase().trim())
}

export interface HistoryRowLike {
  id?: string
  lead_id?: string | null
  user_id?: string | null
  /**
   * Who actually performed the action, when the writer recorded it.
   *
   * `/api/crm/lead-action` stores `user_id` = the lead's workspace owner and `actor_id` = the
   * signed-in human, because the row has to stay readable to the whole workspace. Credit must
   * follow the human, or a rep's call feedback lands on the owner's scoreboard.
   */
  actor_id?: string | null
  action_type?: string | null
  description?: string | null
  created_at?: string | null
}

export interface LeadLike {
  id?: string
  assigned_to?: string | null
  notes?: string | null
  custom_fields?: any
}

export interface RepLike {
  id: string
  name?: string | null
  email?: string | null
}

export type CategoryCounts = Record<FollowupCategory, number>

function emptyCounts(): CategoryCounts {
  return {
    calls: 0,
    dnp: 0,
    visits: 0,
    revisits: 0,
    closing_meetings: 0,
    home_meetings: 0,
    whatsapp: 0,
  }
}

function emptyLeadSets(): Record<FollowupCategory, Set<string>> {
  return {
    calls: new Set(),
    dnp: new Set(),
    visits: new Set(),
    revisits: new Set(),
    closing_meetings: new Set(),
    home_meetings: new Set(),
    whatsapp: new Set(),
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Dates
// ────────────────────────────────────────────────────────────────────────────────

/** Parses custom_fields, which is a TEXT column holding a JSON string in production. */
export function parseCustomFields(raw: any): Record<string, any> {
  let cf = raw
  // Guarded loop: historical rows contain double-encoded JSON.
  for (let i = 0; i < 3 && typeof cf === 'string'; i += 1) {
    try {
      cf = JSON.parse(cf)
    } catch {
      return {}
    }
  }
  return cf && typeof cf === 'object' ? cf : {}
}

function buildIstDate(
  day: number,
  month: number,
  year: number,
  hour: number,
  minute: number,
  second: number
): Date | null {
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null
  if (day < 1 || day > 31) return null
  if (month < 0 || month > 11) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null

  const nowYear = new Date().getUTCFullYear()
  if (year < 2000 || year > nowYear + 2) return null

  const utcMs = Date.UTC(year, month, day, hour, minute, second) - IST_OFFSET_MS
  const date = new Date(utcMs)
  if (Number.isNaN(date.getTime())) return null

  // Reject dates JS silently normalised (e.g. 31 February, month 17).
  const checkParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const got = Object.fromEntries(checkParts.map((p) => [p.type, p.value]))
  if (Number(got.day) !== day || Number(got.month) !== month + 1) return null

  return date
}

/**
 * Extracts the leading "[...]" header from a CRM note block.
 * Returns null when the block does not start with a bracketed header.
 */
export function extractNoteHeader(chunk: string): string | null {
  if (typeof chunk !== 'string') return null
  const trimmed = chunk.trimStart()
  if (!trimmed.startsWith('[')) return null
  const end = trimmed.indexOf(']')
  if (end < 0) return null
  return trimmed.slice(0, end + 1)
}

/**
 * Reads the timestamp out of a note header such as
 *
 *   [📝 Followup (Call) - 19/11/2026, 2:06:22 pm by Devraj Singh Rathore]
 *   [⚠️ Call Not Picked - DNP (19/11/2026, 1:40:54 pm) by Devraj Singh Rathore]
 *   [📝 Remark - 28/10/2026, 5:06:15 pm by rchopra489]
 *
 * Only the header is examined — never the free text that follows it, which is where the
 * agent's own prose (and their typed next-action dates) live.
 */
export function parseNoteHeaderTime(header: string): Date | null {
  if (typeof header !== 'string' || !header) return null

  const match = header.match(
    /([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{4})(?:,?\s*([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*([ap]m)?)?/i
  )
  if (!match) return null

  const a = parseInt(match[1], 10)
  const b = parseInt(match[2], 10)
  const year = parseInt(match[3], 10)
  let hour = match[4] ? parseInt(match[4], 10) : 0
  const minute = match[5] ? parseInt(match[5], 10) : 0
  const second = match[6] ? parseInt(match[6], 10) : 0
  const meridiem = match[7] ? match[7].toLowerCase() : null

  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0

  // The CRM writes day-first ("19/11/2026"). When the second field cannot be a month,
  // the row was written month-first by an import ("11/17/2026") — swap instead of
  // letting Date.UTC roll it into next year.
  const dayFirst = a <= 31 && b <= 12
  const candidates = dayFirst
    ? [
        { day: a, month: b - 1 },
        { day: b, month: a - 1 },
      ]
    : [
        { day: b, month: a - 1 },
        { day: a, month: b - 1 },
      ]

  for (const c of candidates) {
    const parsed = buildIstDate(c.day, c.month, year, hour, minute, second)
    if (parsed) return parsed
  }
  return null
}

/**
 * Resolves the moment a note block describes. Falls back to `fallback` (usually the
 * lead's own timestamp) when the block carries no readable header timestamp.
 */
export function parseNoteBlockTime(chunk: string, fallback?: string | Date | null): Date | null {
  const header = extractNoteHeader(chunk)
  if (header) {
    const fromHeader = parseNoteHeaderTime(header)
    if (fromHeader) return fromHeader
  }
  if (fallback) {
    const d = fallback instanceof Date ? fallback : new Date(fallback)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

/** Whether a timestamp is a usable date at all. */
export function toDate(value: any): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// ────────────────────────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────────────────────────

/** Maps a follow-up *type* label ("Call", "Site Visit", "Closing Meeting"…) to a bucket. */
export function classifyFollowupType(rawType?: string | null): FollowupCategory {
  const t = String(rawType || '').toLowerCase().trim()
  if (!t) return 'calls'
  if (t.includes('dnp') || t.includes('not picked') || t.includes('did not pick')) return 'dnp'
  if (t === 'revisit' || t === 're-visit' || t === 're visit') return 'revisits'
  if (t === 'visit' || t === 'site visit') return 'visits'
  if (t === 'closing meeting' || t === 'closing') return 'closing_meetings'
  if (t === 'home meeting' || t === 'home') return 'home_meetings'
  if (t === 'whatsapp') return 'whatsapp'
  return 'calls'
}

/**
 * Buckets a lead_history row, or returns null when the row is not a follow-up the rep
 * performed (imports, reopens, transfers, webhook noise).
 */
export function classifyHistoryRow(h: HistoryRowLike): FollowupCategory | null {
  const type = String(h.action_type || '').toUpperCase()
  const desc = String(h.description || '').trim()
  const lower = desc.toLowerCase()

  // Purely automated / administrative rows.
  if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT', 'ASSIGNMENT', 'TRANSFER', 'STAGE_CHANGE_AUTO'].includes(type)) {
    return null
  }
  if (
    lower.includes('facebook ad submission') ||
    lower.includes('reopened from facebook') ||
    lower.includes('bulk transferred') ||
    lower.includes('transferred from') ||
    lower.includes('lead transferred')
  ) {
    return null
  }

  // DNP first: "Call Not Picked (DNP)" belongs in dnp, not calls.
  if (type === 'DNP' || lower.includes('dnp') || lower.includes('not picked') || lower.includes('did not pick')) {
    return 'dnp'
  }

  // Explicit "Followup (Type)" from the CRM's own writer.
  const followupMatch = desc.match(/Followup\s*\(([^)]+)\)/i)
  if (followupMatch) return classifyFollowupType(followupMatch[1])

  // Structured action types.
  if (type === 'SITE_VISIT') return 'visits'
  if (type === 'REVISIT') return 'revisits'
  if (type === 'MEETING') return 'closing_meetings'
  if (type === 'WHATSAPP' || type === 'WHATSAPP_CHAT') return 'whatsapp'
  // The follow-up route writes STATUS_CHANGE for a follow-up that also moved the stage; those
  // descriptions start with "📝 Followup (…)" and were matched above. A remaining STATUS_CHANGE
  // is a plain stage edit ("Stage updated to qualified") and is not a follow-up at all.
  if (type === 'STATUS_CHANGE') {
    return lower.includes('followup') || lower.includes('call') || lower.includes('feedback') ? 'calls' : null
  }
  if (['CALL', 'CALL_LOG', 'OUTBOUND_CALL', 'CALL_FEEDBACK', 'FOLLOWUP'].includes(type)) {
    return 'calls'
  }
  if (lower.includes('whatsapp')) return 'whatsapp'
  if (lower.includes('call') || lower.includes('followup') || lower.includes('feedback')) return 'calls'

  return null
}

/** Buckets a lead note block. */
export function classifyNoteBlock(chunk: string): FollowupCategory {
  const lower = String(chunk || '').toLowerCase()
  if (lower.includes('call not picked') || lower.includes('dnp') || lower.includes('not picked')) return 'dnp'
  const fMatch = String(chunk || '').match(/Followup\s*\(([^)]+)\)/i)
  if (fMatch) return classifyFollowupType(fMatch[1])
  return classifyFollowupType(extractNoteHeader(chunk)?.replace(/[[\]]/g, '').split('-')[0] || '')
}

// ────────────────────────────────────────────────────────────────────────────────
// Attribution
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Resolves "by Devraj Singh Rathore" to a rep.
 *
 * The empty-name case is the subtle one: `name.includes('')` is true for every rep, so an
 * unattributed block used to be credited to whichever rep the array happened to yield
 * first. An unattributed block now resolves to null and the caller decides.
 */
export function matchRepByName(text: string | null | undefined, reps: RepLike[]): RepLike | null {
  const needle = String(text || '').toLowerCase().trim()
  if (!needle) return null

  let best: RepLike | null = null
  let bestLen = 0
  for (const rep of reps) {
    const name = String(rep.name || '').toLowerCase().trim()
    const email = String(rep.email || '').toLowerCase().trim()
    const candidates = [name, email].filter(Boolean)
    for (const candidate of candidates) {
      const hit = needle.includes(candidate) || candidate.includes(needle)
      if (hit && candidate.length > bestLen) {
        best = rep
        bestLen = candidate.length
      }
    }
  }
  return best
}

/** Pulls the "by <name>" clause out of a note header. */
export function extractNoteAuthor(chunk: string): string {
  const header = extractNoteHeader(chunk)
  const source = header ?? String(chunk || '').slice(0, 200)
  const match = source.match(/\bby\s+([^\]:\n]+)/i)
  return match ? match[1].trim() : ''
}

function resolveRepIdForNote(chunk: string, lead: LeadLike, reps: RepLike[]): string | null {
  const author = extractNoteAuthor(chunk)
  const matched = matchRepByName(author, reps)
  if (matched) return matched.id
  // No usable author in the block: the lead's assignee is the only defensible owner.
  return lead.assigned_to || null
}

// ────────────────────────────────────────────────────────────────────────────────
// Counting
// ────────────────────────────────────────────────────────────────────────────────

export interface CountFollowupActivityInput {
  history: HistoryRowLike[]
  leads: LeadLike[]
  reps: RepLike[]
  /** Date-range predicate supplied by the caller (timezone-aware). */
  isInRange: (value: Date | string | null | undefined) => boolean
  dedupeWindowMs?: number
}

export interface CountFollowupActivityResult {
  /** repId → per-category counts */
  countsByRep: Record<string, CategoryCounts>
  /** repId → per-category distinct lead ids (for drilldowns) */
  leadsByRep: Record<string, Record<FollowupCategory, Set<string>>>
  /** repId → total counted follow-ups */
  totalByRep: Record<string, number>
  /** lead ids that contributed a history row inside the range */
  countedHistoryLeadIds: Set<string>
}

export function countFollowupActivity(input: CountFollowupActivityInput): CountFollowupActivityResult {
  const { history, leads, reps } = input
  const dedupeWindowMs = input.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS
  const isInRange = input.isInRange

  const countsByRep: Record<string, CategoryCounts> = {}
  const leadsByRep: Record<string, Record<FollowupCategory, Set<string>>> = {}
  const totalByRep: Record<string, number> = {}
  const countedHistoryLeadIds = new Set<string>()

  for (const rep of reps) {
    countsByRep[rep.id] = emptyCounts()
    leadsByRep[rep.id] = emptyLeadSets()
    totalByRep[rep.id] = 0
  }

  // Per-lead memory of what has already been counted, so a follow-up written twice (the
  // API route and the offline fallback both landing) counts once.
  const seenByLead = new Map<string, Array<{ cat: FollowupCategory; time: number }>>()

  const record = (
    repId: string | null | undefined,
    leadId: string | null | undefined,
    cat: FollowupCategory,
    when: Date | null
  ): boolean => {
    if (!repId || !when) return false
    if (!isInRange(when)) return false
    if (!countsByRep[repId]) return false

    const time = when.getTime()
    if (leadId) {
      const seen = seenByLead.get(leadId) || []
      if (seen.some((e) => e.cat === cat && Math.abs(e.time - time) < dedupeWindowMs)) return false
      seen.push({ cat, time })
      seenByLead.set(leadId, seen)
    }

    countsByRep[repId][cat] += 1
    totalByRep[repId] += 1
    if (leadId) leadsByRep[repId][cat].add(leadId)
    return true
  }

  // 1. Lead history — created_at is the only trustworthy clock.
  for (const row of history) {
    const when = toDate(row.created_at)
    if (!when || !isInRange(when)) continue
    const cat = classifyHistoryRow(row)
    if (!cat) continue
    if (row.lead_id) countedHistoryLeadIds.add(row.lead_id)
    // The human who did it, not the workspace that owns the row. Fall back to the credited
    // owner when the actor is not someone this workspace can report on, so the follow-up is
    // attributed to somebody rather than disappearing from the workspace total.
    const actor = row.actor_id || null
    const owner = row.user_id || null
    const repId = actor && countsByRep[actor] ? actor : owner
    record(repId, row.lead_id, cat, when)
  }

  // 2. Notes / custom_fields — gap-fill for leads with no history row in range only.
  for (const lead of leads) {
    if (!lead?.id) continue
    if (countedHistoryLeadIds.has(lead.id)) continue

    const notes = String(lead.notes || '')
    if (notes.includes('[📝') || notes.includes('[⚠️')) {
      const blocks = notes.split(/(?=\[(?:📝|⚠️))/)
      for (const block of blocks) {
        if (!extractNoteHeader(block)) continue
        const when = parseNoteBlockTime(block)
        if (!when) continue
        if (!isInRange(when)) continue
        record(resolveRepIdForNote(block, lead, reps), lead.id, classifyNoteBlock(block), when)
      }
    }

    const cf = parseCustomFields(lead.custom_fields)

    if (Array.isArray(cf.followups)) {
      for (const f of cf.followups) {
        const when = toDate(f?.date) || parseNoteBlockTime(String(f?.note || ''))
        if (!when) continue
        const repId =
          matchRepByName(String(f?.rep_name || f?.by || ''), reps)?.id || (lead.assigned_to as string) || null
        record(repId, lead.id, classifyFollowupType(f?.followupType || f?.type), when)
      }
    }

    if (cf.last_followup_at) {
      const when = toDate(cf.last_followup_at)
      if (when && isInRange(when)) {
        const cat =
          cf.last_call_dnp === true
            ? 'dnp'
            : classifyFollowupType(cf.last_followup_type)
        record(lead.assigned_to, lead.id, cat, when)
      }
    }
  }

  return { countsByRep, leadsByRep, totalByRep, countedHistoryLeadIds }
}
