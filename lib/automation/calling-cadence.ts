/**
 * Deterministic calling cadence for "fresh" leads that have not accepted an
 * answer yet.
 *
 * WHY PURE / DETERMINISTIC
 * The previous attempt at this (`followup-333-engine.ts`) generated its
 * parameters with an LLM. Great copy, but a cadence you cannot predict is a
 * cadence you cannot debug, bill, or explain to a customer asking "why did your
 * bot call my lead four times?". Scheduling lives here; the LLM is still used
 * for *what to say*, never for *when to call*.
 *
 * SEMANTICS
 * A lead is chased until one of these happens:
 *   - they book (booked_time set)            -> stopped in SQL
 *   - they leave the "fresh" pipeline stages -> stopped in SQL
 *   - they opt out / unsubscribe             -> stopped in SQL
 *   - attempt cap or age cap is hit          -> stopped here
 * Every attempt is placed inside the tenant's calling window, in the tenant's
 * timezone.
 */

/** Offsets in HOURS from the moment the lead was created. */
export const DEFAULT_CALL_CADENCE_HOURS: readonly number[] = [
  // Day 1 — strike while the enquiry is warm
  1, 3,
  // Day 2, 3, 4 — daily
  24, 30, 48, 54, 72,
  // Day 5, 7 — taper
  120, 168,
  // Day 14, 21 — weeks
  336, 504,
  // Day 30, 45, 60, 90 — months, then tail
  720, 1080, 1440, 2160,
]

export interface CadenceConfig {
  /** Offsets in hours from lead.created_at. Defaults to DEFAULT_CALL_CADENCE_HOURS. */
  cadenceHours?: readonly number[]
  /** Spacing (days) once the cadence table is exhausted. */
  tailDays?: number
  /** Hard stop for very old leads. */
  maxAgeDays?: number
  /** Inclusive local hour the first call may start. */
  windowStart?: number
  /** Exclusive local hour after which no call may start. */
  windowEnd?: number
  timezone?: string
}

export interface CadenceState {
  createdAt: Date
  attemptCount: number
  lastAttemptAt?: Date | null
  now?: Date
  /** Set when a previous pass explicitly scheduled the next attempt. */
  scheduledAt?: Date | null
}

export interface CadenceDecision {
  dueAt: Date | null
  isDue: boolean
  reason: string
  /** 1-based label of the attempt being decided on. */
  attemptNumber: number
}

/* ------------------------------------------------------------------ */
/* timezone helpers — no external dependency                          */
/* ------------------------------------------------------------------ */

const MS_MIN = 60_000
const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(date: Date, timeZone: string): WallClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl can emit "24" for midnight in some environments
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

/** Offset of `timeZone` from UTC at the given instant, in minutes. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MS_MIN)
}

/** Local hour (0-23) of the instant in the timezone. */
export function localHour(date: Date, timeZone: string): number {
  return wallClock(date, timeZone).hour
}

/**
 * Build the instant corresponding to a local wall-clock time. The offset can
 * itself depend on the instant (DST), so resolve it iteratively.
 */
export function atLocalTime(
  baseDate: Date,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const w = wallClock(baseDate, timeZone)
  const naiveUtc = Date.UTC(w.year, w.month - 1, w.day, hour, minute, 0)
  let guess = naiveUtc - tzOffsetMinutes(baseDate, timeZone) * MS_MIN
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMinutes(new Date(guess), timeZone)
    const next = naiveUtc - offset * MS_MIN
    if (next === guess) break
    guess = next
  }
  return new Date(guess)
}

/** True when `date` falls inside the [start, end) local-hour window. */
export function isWithinCallWindow(
  date: Date,
  windowStart: number,
  windowEnd: number,
  timeZone: string
): boolean {
  const h = localHour(date, timeZone)
  if (windowStart === windowEnd) return true
  if (windowStart < windowEnd) return h >= windowStart && h < windowEnd
  // window wraps midnight, e.g. 22 -> 6
  return h >= windowStart || h < windowEnd
}

/** Move `date` forward to the next opening of the calling window. */
export function nextWindowOpen(
  date: Date,
  windowStart: number,
  windowEnd: number,
  timeZone: string
): Date {
  if (isWithinCallWindow(date, windowStart, windowEnd, timeZone)) return date
  const h = localHour(date, timeZone)
  const afterClose = windowStart < windowEnd ? h >= windowEnd : false
  const base = afterClose ? new Date(date.getTime() + MS_DAY) : date
  return atLocalTime(base, windowStart, 0, timeZone)
}

/* ------------------------------------------------------------------ */
/* the decision                                                       */
/* ------------------------------------------------------------------ */

/**
 * Work out when this lead's next call should happen.
 *
 * Pure: same inputs -> same output. No DB, no clock of its own (pass `now`).
 */
export function evaluateCadence(
  state: CadenceState,
  config: CadenceConfig = {}
): CadenceDecision {
  const cadenceHours = config.cadenceHours?.length
    ? [...config.cadenceHours]
    : [...DEFAULT_CALL_CADENCE_HOURS]
  const tailDays = Math.max(1, config.tailDays ?? 30)
  const maxAgeDays = Math.max(1, config.maxAgeDays ?? 365)
  const windowStart = config.windowStart ?? 9
  const windowEnd = config.windowEnd ?? 19
  const timezone = config.timezone || 'Asia/Kolkata'

  const now = state.now ?? new Date()
  const attemptNumber = Math.max(0, state.attemptCount) + 1

  // 1. An explicit schedule always wins (e.g. a human pressed "call in an hour").
  if (state.scheduledAt) {
    const dueAt = nextWindowOpen(state.scheduledAt, windowStart, windowEnd, timezone)
    return {
      dueAt,
      isDue: dueAt.getTime() <= now.getTime(),
      reason: 'explicitly_scheduled',
      attemptNumber,
    }
  }

  // 2. Age cap.
  const ageDays = (now.getTime() - state.createdAt.getTime()) / MS_DAY
  if (ageDays > maxAgeDays) {
    return { dueAt: null, isDue: false, reason: 'max_age_exceeded', attemptNumber }
  }

  // 3. Which slot are we on?
  let raw: Date
  let reason: string
  if (state.attemptCount < cadenceHours.length) {
    raw = new Date(state.createdAt.getTime() + cadenceHours[state.attemptCount] * MS_HOUR)
    reason = `cadence_slot_${state.attemptCount + 1}_of_${cadenceHours.length}`
  } else {
    const base = state.lastAttemptAt ?? state.createdAt
    raw = new Date(base.getTime() + tailDays * MS_DAY)
    reason = 'tail_interval'
  }

  // 4. Never call outside the window.
  const dueAt = nextWindowOpen(raw, windowStart, windowEnd, timezone)

  return {
    dueAt,
    isDue: dueAt.getTime() <= now.getTime(),
    reason,
    attemptNumber,
  }
}

/** Convenience wrapper for a batch, used by the cron. */
export function selectDueLeads<T extends { id: string }>(
  rows: Array<T & CadenceState>,
  config: CadenceConfig
): Array<T & { decision: CadenceDecision }> {
  const out: Array<T & { decision: CadenceDecision }> = []
  for (const row of rows) {
    const decision = evaluateCadence(row, config)
    if (decision.isDue) out.push({ ...row, decision })
  }
  return out
}
