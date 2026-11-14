/**
 * End-of-day report content.
 *
 * WHY THIS FILE EXISTS
 * The EOD report used to be built inline in the cron worker: one fixed HTML
 * template that opened with "Today was a productive day for X", a "Completed N
 * AI Voice Calls" line that fired even at N = 0, a "N leads" label applied to
 * every business, and no mention at all of the thing the product is sold for —
 * the creatives, videos and pages the department actually produced. 1,286 of
 * those went out. Several of their sentences were simply untrue.
 *
 * So content generation moved here, into one PURE function. `buildEodReport`
 * receives every raw fact as an argument (including `now`) and returns the
 * subject, headline, sentiment, metrics, sections, WhatsApp text and email HTML.
 * No Supabase, no network, no `Date.now()`. The worker's only remaining job is to
 * gather facts and send.
 *
 * RULES THIS FILE ENFORCES
 *  1. Every sentence is derived from a number in the input. Nothing is invented,
 *     and a line is omitted entirely when its fact is unavailable.
 *  2. A zero day says so plainly, in one sentence, plus one concrete next step.
 *     No boosterism, no "productive day" filler, no emoji soup.
 *  3. Nouns come from `industryVocabulary()` (plus a per-vertical lead word), so
 *     a film academy is never told about properties and an unknown/NULL industry
 *     gets neutral words instead of inheriting real-estate copy.
 *  4. The WhatsApp text and the email are built from the SAME fact lines, so the
 *     two channels cannot tell different stories.
 *  5. "Today" is a local day in the tenant's timezone (`dayWindow`), never a
 *     rolling 24 hours off the server clock.
 */

import { industryVocabulary } from './industry'

/* ------------------------------------------------------------------ */
/* Shapes                                                             */
/* ------------------------------------------------------------------ */

export type EodSentiment = 'quiet' | 'normal' | 'good' | 'attention'

export interface EodMetric {
  key: string
  label: string
  value: string
  hint?: string
}

export interface EodRow {
  label: string
  value: string
}

export interface EodSection {
  key: string
  title: string
  /** Final prose. One short declarative sentence per line. */
  lines: string[]
  /** Small label/value table, e.g. pipeline stages. */
  rows?: EodRow[]
}

export interface EodReport {
  subject: string
  headline: string
  sentiment: EodSentiment
  metrics: EodMetric[]
  sections: EodSection[]
  whatsappText: string
  html: string
  /** 'YYYY-MM-DD' in the tenant's timezone: the idempotency key for the day. */
  periodKey: string
  /** Human date in the tenant's timezone, e.g. "12 November 2026". */
  dateLabel: string
  timezone: string
  /** Every plain-sentence fact rendered by both channels, for auditing. */
  facts: string[]
}

export interface EodRoutineFacts {
  enabled?: boolean | null
  name?: string | null
  cadence?: string | null
  /** routine_runs.status for today's period key, when a run row exists. */
  todayRunStatus?: string | null
  lastRunAt?: string | null
}

export interface EodCampaignFacts {
  total?: number | null
  active?: number | null
  /** Meta's own lifetime spend figure for the linked ad account. */
  spendToDate?: number | null
  /** Meta's own "results" count. Not necessarily CRM leads — never call it that. */
  results?: number | null
}

export interface EodReportInput {
  /** Passed in, never read from the clock: this is what makes the module pure. */
  now: Date
  /** Tenant timezone, `profiles.timezone`. Defaults to Asia/Kolkata. */
  timezone?: string | null
  /** `profiles.currency`, e.g. 'INR'. */
  currency?: string | null
  businessName?: string | null
  /** `profiles.industry`; NULL/unknown resolves to neutral vocabulary. */
  industry?: string | null
  /** Playbook positioning: the one line the business describes itself with. */
  positioning?: string | null
  dashboardUrl?: string | null

  leads?: {
    total?: number | null
    newToday?: number | null
    newPreviousDay?: number | null
    pipeline?: Array<{ stage?: string | null; count?: number | null }> | null
  } | null

  whatsapp?: {
    totalToday?: number | null
    inboundToday?: number | null
    outboundToday?: number | null
    previousDayTotal?: number | null
  } | null

  calls?: {
    attempted?: number | null
    connected?: number | null
    failed?: number | null
  } | null

  production?: {
    /** assets of type image created today. */
    creatives?: number | null
    /** assets of type video created today. */
    videos?: number | null
    /** assets that reached a finished state today. */
    assetsReady?: number | null
    assetsFailed?: number | null
    /** landing_pages created today. */
    pagesPublished?: number | null
    /** site_build_jobs completed today. */
    sitesBuilt?: number | null
  } | null

  credits?: {
    /** Sum of today's credit_transactions deductions. */
    spentToday?: number | null
    /** profiles.credits on the paying owner. */
    balance?: number | null
    /** usage_events.cost_inr for today; used only when the ledger is unreadable. */
    usageCostToday?: number | null
  } | null

  /** `business_routines` + today's `routine_runs` row, when those tables exist. */
  routine?: EodRoutineFacts | null

  /** Playbook `daily_routine.jobs`, described without inventing anything. */
  dailyRoutineJobs?: Array<{ kind?: string | null; at?: string | null; everyDays?: number | null }> | null

  campaigns?: EodCampaignFacts | null
}

/* ------------------------------------------------------------------ */
/* Local day boundaries (tenant timezone, not the server's)            */
/* ------------------------------------------------------------------ */

export interface DayWindow {
  timezone: string
  /** First instant of today, local. */
  start: Date
  /** First instant of tomorrow, local (exclusive upper bound). */
  end: Date
  /** First instant of yesterday, local. */
  previousStart: Date
  /** 'YYYY-MM-DD' local, matching lib/agent/routines periodKey(). */
  periodKey: string
  /** "12 November 2026" in en-IN. */
  dateLabel: string
}

const MS_MINUTE = 60_000

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(date: Date, timeZone: string): WallClock {
  const parts: Record<string, string> = {}
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
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = p.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // Intl can emit "24" at midnight
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

/** Offset of `timeZone` from UTC at that instant, in minutes. */
function offsetMinutes(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MS_MINUTE)
}

/** The instant of local wall-clock time on `date`'s local calendar day. */
function atLocalMidnight(date: Date, timeZone: string): Date {
  const w = wallClock(date, timeZone)
  const naive = Date.UTC(w.year, w.month - 1, w.day, 0, 0, 0)
  let guess = naive - offsetMinutes(date, timeZone) * MS_MINUTE
  // The offset can itself depend on the instant (DST), so resolve it twice.
  for (let i = 0; i < 2; i++) {
    const next = naive - offsetMinutes(new Date(guess), timeZone) * MS_MINUTE
    if (next === guess) break
    guess = next
  }
  return new Date(guess)
}

function safeTimezone(timezone?: string | null): string {
  const tz = String(timezone || '').trim()
  if (!tz) return 'Asia/Kolkata'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date(0))
    return tz
  } catch {
    return 'Asia/Kolkata'
  }
}

/**
 * Local day window for `now`. This is the fix for the old
 * `new Date(Date.now() - 24h)`: at 00:30 IST that "start of today" was 00:30
 * yesterday, so an hour of the previous evening's rows were reported as today.
 */
export function dayWindow(now: Date, timezone?: string | null): DayWindow {
  const tz = safeTimezone(timezone)
  const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  const start = atLocalMidnight(at, tz)
  const previousStart = atLocalMidnight(new Date(start.getTime() - 1), tz)
  // +25h always lands on the next local calendar day, even across a 23h/25h DST day.
  const end = atLocalMidnight(new Date(start.getTime() + 25 * 3_600_000), tz)
  const w = wallClock(start, tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    timezone: tz,
    start,
    end,
    previousStart,
    periodKey: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    dateLabel: new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(at),
  }
}

/** Which side of the window an instant falls on. Used to select rows honestly. */
export function classifyInstant(
  instant: string | Date | null | undefined,
  window: DayWindow
): 'today' | 'previous' | 'outside' {
  if (!instant) return 'outside'
  const at = instant instanceof Date ? instant : new Date(instant)
  const ms = at.getTime()
  if (Number.isNaN(ms)) return 'outside'
  if (ms >= window.start.getTime() && ms < window.end.getTime()) return 'today'
  if (ms >= window.previousStart.getTime() && ms < window.start.getTime()) return 'previous'
  return 'outside'
}

/* ------------------------------------------------------------------ */
/* Voice calls: attempted / connected / failed                        */
/* ------------------------------------------------------------------ */

const CALL_MARKER = '🎙️ CALL_JSON:'

export interface CallTally {
  /** Every call-log row. A row means a call was attempted, not that it worked. */
  attempted: number
  /** The person on the other end actually spoke (or the provider said so). */
  connected: number
  /** The attempt is on record and did not connect. */
  failed: number
}

function callOutcome(parsed: unknown): 'connected' | 'failed' | 'unknown' {
  if (!parsed || typeof parsed !== 'object') return 'unknown'
  const row = parsed as Record<string, any>

  const explicit = String(row.status ?? row.call_status ?? row.outcome ?? row.disposition ?? '')
    .trim()
    .toLowerCase()
  if (explicit) {
    if (/connect|complete|answer(?:ed)?|success|talked/.test(explicit) && !/no_answer|unanswered|not_connected/.test(explicit)) {
      return 'connected'
    }
    if (/no_answer|no-answer|unanswered|busy|fail|reject|cancel|missed|declined|error/.test(explicit)) {
      return 'failed'
    }
  }

  // The webhook's own definition of a real conversation: the lead said something.
  const transcript = Array.isArray(row.transcript) ? row.transcript : []
  const leadSpoke = transcript.some((entry: any) => {
    const role = String(entry?.role || '').trim().toLowerCase()
    const message = String(entry?.message ?? entry?.text ?? '')
    return (role === 'user' || role === 'lead') && /[a-zA-Z0-9\u0900-\u097F]/.test(message)
  })
  if (leadSpoke) return 'connected'
  // The agent spoke but the lead never did: the call was placed and did not connect.
  if (transcript.length > 0) return 'failed'
  // A recording with no transcript is still evidence the call happened and was answered.
  if (row.recording_url || row.recordingUrl) return 'connected'
  return 'unknown'
}

/**
 * Turn raw `lead_history` REMARK rows into attempted/connected/failed counts.
 * A row that cannot be attributed counts as attempted only — never as connected.
 */
export function summarizeCallHistory(
  rows: Array<{ description?: string | null }> | null | undefined
): CallTally {
  let attempted = 0
  let connected = 0
  let failed = 0
  for (const row of rows || []) {
    const description = String(row?.description || '')
    if (!description.startsWith(CALL_MARKER)) continue
    attempted++
    let parsed: unknown = null
    try {
      parsed = JSON.parse(description.slice(CALL_MARKER.length).trim())
    } catch {
      parsed = null
    }
    const outcome = callOutcome(parsed)
    if (outcome === 'connected') connected++
    else if (outcome === 'failed') failed++
  }
  return { attempted, connected, failed }
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                         */
/* ------------------------------------------------------------------ */

interface ReportWords {
  leadOne: string
  leadMany: string
  /** Plural product noun ("listings", "courses"), or null when neutral. */
  productMany: string | null
}

/**
 * What a "lead" and a "catalogue item" are called for this vertical.
 * `industryVocabulary()` decides the vertical; NULL/unknown is generic, so an
 * untagged tenant can never inherit real-estate words.
 */
function reportWords(industry?: string | null): ReportWords {
  const vocab = industryVocabulary(industry)
  switch (vocab.key) {
    case 'real_estate':
      return { leadOne: 'enquiry', leadMany: 'enquiries', productMany: vocab.productNounPlural }
    case 'education':
      return { leadOne: 'applicant', leadMany: 'applicants', productMany: vocab.productNounPlural }
    case 'immigration':
      return { leadOne: 'case enquiry', leadMany: 'case enquiries', productMany: vocab.productNounPlural }
    default:
      // Neutral: plain CRM words, and no product noun, so nothing is implied.
      return { leadOne: 'lead', leadMany: 'leads', productMany: null }
  }
}

/* ------------------------------------------------------------------ */
/* Formatting (India-first)                                           */
/* ------------------------------------------------------------------ */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function count(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.trunc(n))
}

function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n
}

/** en-IN grouping, because the audience is Indian and "1,20,000" is not a typo. */
function fmtNumber(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)
}

function fmtMoney(value: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : `${currency} `
  return `${symbol}${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)}`
}

function fmtStamp(iso: string | null | undefined, timezone: string): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at)
}

function plural(n: number, one: string, many: string): string {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`
}

function labelCase(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/* ------------------------------------------------------------------ */
/* The report                                                         */
/* ------------------------------------------------------------------ */

export function buildEodReport(input: EodReportInput): EodReport {
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date(input.now)
  const window = dayWindow(now, input.timezone)
  const tz = window.timezone
  const currency = String(input.currency || 'INR').trim().toUpperCase() || 'INR'
  const businessName = String(input.businessName || '').trim() || 'Your business'
  const positioning = String(input.positioning || '').trim()
  const words = reportWords(input.industry)
  const dashboardUrl = String(input.dashboardUrl || '').trim()

  // ---- facts in ----
  const leadsTotal = count(input.leads?.total)
  const newLeads = count(input.leads?.newToday)
  const newLeadsPrev = count(input.leads?.newPreviousDay)

  const waTotal = count(input.whatsapp?.totalToday)
  const waIn = count(input.whatsapp?.inboundToday)
  const waOut = count(input.whatsapp?.outboundToday)
  const waPrev = count(input.whatsapp?.previousDayTotal)

  const attempted = count(input.calls?.attempted)
  const connected = count(input.calls?.connected)
  const callsFailed = count(input.calls?.failed)

  const creatives = count(input.production?.creatives)
  const videos = count(input.production?.videos)
  const assetsReady = count(input.production?.assetsReady)
  const assetsFailed = count(input.production?.assetsFailed)
  const pagesPublished = count(input.production?.pagesPublished)
  const sitesBuilt = count(input.production?.sitesBuilt)

  const creditsSpent = amount(input.credits?.spentToday)
  const creditBalance = amount(input.credits?.balance)
  const usageCost = amount(input.credits?.usageCostToday)

  const producedTotal =
    (creatives ?? 0) + (videos ?? 0) + (pagesPublished ?? 0) + (sitesBuilt ?? 0)
  const connections = connected ?? 0
  const att = attempted ?? 0

  // ---- quiet, sentiment ----
  const quiet =
    (newLeads ?? 0) === 0 && (waTotal ?? 0) === 0 && att === 0 && producedTotal === 0 && (assetsReady ?? 0) === 0

  const routine = input.routine || null
  const routineOn = routine ? routine.enabled !== false : null
  const routineRunMissing = routineOn === true && routine != null && !routine.todayRunStatus
  const routineRunFailed = !!routine && /fail|error|dead|abort/i.test(String(routine.todayRunStatus || ''))

  const attention =
    !quiet &&
    ((att > 0 && connections === 0) ||
      (assetsFailed ?? 0) > 0 ||
      routineRunFailed ||
      routineRunMissing)

  const sentiment: EodSentiment = quiet
    ? 'quiet'
    : attention
      ? 'attention'
      : (newLeads ?? 0) > 0 || connections > 0 || producedTotal > 0 || (assetsReady ?? 0) > 0
        ? 'good'
        : 'normal'

  // ---- activity facts (leads / WhatsApp / calls) ----
  const activityFacts: string[] = []
  if (quiet) {
    activityFacts.push(
      `No new ${words.leadMany}, no WhatsApp messages, no calls and nothing produced.`
    )
  } else {
    if ((newLeads ?? 0) > 0) {
      const prev = newLeadsPrev != null ? ` (${fmtNumber(newLeadsPrev)} the day before)` : ''
      activityFacts.push(`${plural(newLeads as number, `new ${words.leadOne}`, `new ${words.leadMany}`)} today${prev}.`)
    } else {
      activityFacts.push(`No new ${words.leadMany} today.`)
    }

    if ((waTotal ?? 0) > 0) {
      const dir =
        waIn != null && waOut != null ? ` (${fmtNumber(waIn)} in, ${fmtNumber(waOut)} out)` : ''
      activityFacts.push(`${plural(waTotal as number, 'WhatsApp message', 'WhatsApp messages')}${dir}.`)
    } else {
      activityFacts.push('No WhatsApp messages today.')
    }

    if (att > 0) {
      const tail =
        connections === 0
          ? 'none connected'
          : `${fmtNumber(connections)} connected${(callsFailed ?? 0) > 0 ? `, ${fmtNumber(callsFailed as number)} did not` : ''}`
      activityFacts.push(`${plural(att, 'call', 'calls')} attempted, ${tail}.`)
    } else {
      activityFacts.push('No calls attempted today.')
    }
  }

  // ---- production facts (the actual product of the department) ----
  const productionFacts: string[] = []
  if (producedTotal > 0) {
    const forProducts = words.productMany ? ` for your ${words.productMany}` : ''
    if ((creatives ?? 0) > 0) {
      productionFacts.push(`${plural(creatives as number, 'creative', 'creatives')} made${forProducts}.`)
    }
    if ((videos ?? 0) > 0) {
      productionFacts.push(`${plural(videos as number, 'video', 'videos')} made${forProducts}.`)
    }
    if ((assetsReady ?? 0) > 0) {
      productionFacts.push(`${plural(assetsReady as number, 'file', 'files')} finished and ready to use.`)
    }
    if ((pagesPublished ?? 0) > 0) {
      productionFacts.push(`${plural(pagesPublished as number, 'landing page', 'landing pages')} published.`)
    }
    if ((sitesBuilt ?? 0) > 0) {
      productionFacts.push(`${plural(sitesBuilt as number, 'website', 'websites')} built.`)
    }
    if ((assetsFailed ?? 0) > 0) {
      productionFacts.push(`${plural(assetsFailed as number, 'file', 'files')} failed to render.`)
    }
  }

  // ---- cost facts ----
  const costFacts: string[] = []
  if (creditsSpent != null) {
    costFacts.push(
      creditsSpent > 0
        ? `Credits used today: ${fmtNumber(creditsSpent)}.`
        : 'No credits used today.'
    )
  } else if (usageCost != null && usageCost > 0) {
    // The credit ledger was unreadable; report the vendor cost we actually saw.
    costFacts.push(`Vendor usage today: ${fmtMoney(usageCost, currency)}.`)
  }
  if (creditBalance != null) costFacts.push(`Balance: ${fmtNumber(creditBalance)} credits.`)

  // ---- pipeline ----
  const pipelineRows: EodRow[] = []
  for (const entry of input.leads?.pipeline || []) {
    const n = count(entry?.count)
    if (n == null || n === 0) continue
    const stage = String(entry?.stage || '').trim()
    if (!stage) continue
    pipelineRows.push({ label: labelCase(stage), value: fmtNumber(n) })
  }
  pipelineRows.sort((a, b) => Number(b.value.replace(/[^\d]/g, '')) - Number(a.value.replace(/[^\d]/g, '')))
  const pipelineFacts: string[] = []
  if (leadsTotal != null && leadsTotal > 0) {
    pipelineFacts.push(`${plural(leadsTotal, words.leadOne, words.leadMany)} in the CRM.`)
  }

  // ---- routine ----
  const routineFacts: string[] = []
  if (routine) {
    if (routine.enabled === false) {
      routineFacts.push('The daily routine is switched off, so nothing is scheduled.')
    } else {
      const cadence = String(routine.cadence || '').trim()
      routineFacts.push(`The daily routine is on${cadence ? ` (${cadence})` : ''}.`)
      if (routine.todayRunStatus) {
        routineFacts.push(`Today's run: ${String(routine.todayRunStatus)}.`)
      } else {
        routineFacts.push('No run is recorded for today.')
      }
      const lastRun = fmtStamp(routine.lastRunAt, tz)
      if (lastRun) routineFacts.push(`Last run: ${lastRun}.`)
    }
    const jobs = (input.dailyRoutineJobs || [])
      .map((job) => {
        const kind = String(job?.kind || '').trim()
        if (!kind) return null
        const at = String(job?.at || '').trim()
        const everyDays = count(job?.everyDays)
        if (at) return `${kind} at ${at}`
        if (everyDays != null && everyDays > 0) {
          return `${kind} every ${everyDays === 1 ? 'day' : `${fmtNumber(everyDays)} days`}`
        }
        return kind
      })
      .filter((v): v is string => !!v)
    if (jobs.length) routineFacts.push(`Planned work: ${jobs.join(', ')}.`)
  }

  // ---- campaigns (Meta) ----
  const campaignFacts: string[] = []
  const campaigns = input.campaigns || null
  if (campaigns) {
    const total = count(campaigns.total)
    const active = count(campaigns.active)
    const spend = amount(campaigns.spendToDate)
    const results = count(campaigns.results)
    if (total != null && total > 0) {
      campaignFacts.push(`${fmtNumber(active ?? 0)} of ${plural(total, 'campaign', 'campaigns')} running.`)
    }
    if (spend != null && spend > 0) {
      campaignFacts.push(`Spend to date: ${fmtMoney(spend, currency)}.`)
    }
    if (results != null && results > 0) {
      // Meta's "results" are whatever objective the campaign optimises for. They are
      // not this business's CRM records, and the report must not imply that they are.
      campaignFacts.push(`Meta reports ${plural(results, 'result', 'results')}.`)
      campaignFacts.push(`Meta's results are its own count, not ${words.leadMany} in your CRM.`)
    }
  }

  // ---- one concrete next step, or none ----
  const nextStep = pickNextStep({
    quiet,
    routine,
    routineOn,
    routineRunFailed,
    creditBalance,
    leadsTotal,
    att,
    connections,
    assetsFailed,
    leadMany: words.leadMany,
  })

  // ---- headline ----
  const headlineParts: string[] = []
  if (!quiet) {
    if ((newLeads ?? 0) > 0) {
      headlineParts.push(plural(newLeads as number, `new ${words.leadOne}`, `new ${words.leadMany}`))
    }
    if ((waTotal ?? 0) > 0) {
      headlineParts.push(plural(waTotal as number, 'WhatsApp message', 'WhatsApp messages'))
    }
    if (att > 0) {
      headlineParts.push(
        connections > 0 ? `${fmtNumber(connections)} calls connected` : `${fmtNumber(att)} calls attempted, none connected`
      )
    }
    if (producedTotal > 0) {
      headlineParts.push(`${plural(producedTotal, 'asset', 'assets')} produced`)
    }
  }
  const headline = quiet
    ? 'Nothing came in today.'
    : headlineParts.length
      ? `Today: ${headlineParts.join(' · ')}.`
      : 'A normal day: nothing to report.'

  // ---- metrics (counts only, never a claim) ----
  const metrics: EodMetric[] = []
  if ((newLeads ?? 0) > 0) {
    metrics.push({
      key: 'new_leads',
      label: `New ${words.leadMany}`,
      value: fmtNumber(newLeads as number),
      hint: newLeadsPrev != null ? `${fmtNumber(newLeadsPrev)} the day before` : undefined,
    })
  }
  if ((waTotal ?? 0) > 0) {
    const parts: string[] = []
    if (waIn != null && waOut != null) parts.push(`${fmtNumber(waIn)} in · ${fmtNumber(waOut)} out`)
    if (waPrev != null) parts.push(`${fmtNumber(waPrev)} the day before`)
    metrics.push({
      key: 'whatsapp',
      label: 'WhatsApp messages',
      value: fmtNumber(waTotal as number),
      hint: parts.length ? parts.join(' · ') : undefined,
    })
  }
  if (att > 0) {
    metrics.push({
      key: 'calls',
      label: 'Calls connected',
      value: `${fmtNumber(connections)} / ${fmtNumber(att)}`,
      hint: connections === 0 ? 'none connected' : undefined,
    })
  }
  if (producedTotal > 0) {
    metrics.push({ key: 'produced', label: 'Assets produced', value: fmtNumber(producedTotal) })
  }
  if (creditBalance != null) {
    metrics.push({ key: 'credits', label: 'Credits left', value: fmtNumber(creditBalance) })
  }

  // ---- sections ----
  const sections: EodSection[] = [{ key: 'activity', title: 'Today', lines: activityFacts }]

  if (productionFacts.length) {
    sections.push({
      key: 'production',
      title: 'What the marketing department produced',
      lines: productionFacts,
    })
  }
  if (pipelineRows.length || pipelineFacts.length) {
    sections.push({
      key: 'pipeline',
      title: 'CRM pipeline',
      lines: pipelineFacts,
      rows: pipelineRows.length ? pipelineRows : undefined,
    })
  }
  if (routineFacts.length) {
    sections.push({ key: 'routine', title: 'Daily routine', lines: routineFacts })
  }
  if (campaignFacts.length) {
    sections.push({ key: 'campaigns', title: 'Meta ads', lines: campaignFacts })
  }
  if (costFacts.length) {
    sections.push({ key: 'cost', title: 'Cost', lines: costFacts })
  }
  if (nextStep) {
    sections.push({ key: 'next', title: 'Next step', lines: [nextStep] })
  }

  const facts = [...activityFacts, ...productionFacts, ...pipelineFacts, ...campaignFacts, ...costFacts]

  const subject = `${businessName} · EOD ${window.dateLabel}`
  const whatsappText = buildWhatsappText({
    businessName,
    positioning,
    dateLabel: window.dateLabel,
    headline,
    activityFacts,
    productionFacts,
    pipelineFacts,
    campaignFacts,
    costFacts,
    nextStep,
    dashboardUrl,
  })

  const html = buildHtml({
    businessName,
    positioning,
    dateLabel: window.dateLabel,
    headline,
    sentiment,
    metrics,
    sections,
  })

  return {
    subject,
    headline,
    sentiment,
    metrics,
    sections,
    whatsappText,
    html,
    periodKey: window.periodKey,
    dateLabel: window.dateLabel,
    timezone: tz,
    facts,
  }
}

/* ------------------------------------------------------------------ */
/* Next step                                                          */
/* ------------------------------------------------------------------ */

function pickNextStep(ctx: {
  quiet: boolean
  routine: EodRoutineFacts | null
  routineOn: boolean | null
  routineRunFailed: boolean
  creditBalance: number | null
  leadsTotal: number | null
  att: number
  connections: number
  assetsFailed: number | null
  leadMany: string
}): string | null {
  if (ctx.routine && ctx.routineOn === false) {
    return 'The daily routine is off, so nothing runs tomorrow either. Turn it on in the CEO tab.'
  }
  if (ctx.routine && ctx.routineOn === true && !ctx.routine.todayRunStatus) {
    return "The routine is on but has no run recorded for today. Open the CEO tab to see why."
  }
  if (ctx.routineRunFailed) {
    return "Today's routine run failed. The error is in the CEO tab."
  }
  if (ctx.creditBalance != null && ctx.creditBalance <= 0) {
    return 'Credits are at zero, so nothing can be generated until you top up.'
  }
  if (ctx.quiet) {
    if (ctx.routine && ctx.routine.todayRunStatus) {
      return 'The routine ran and nothing came in. If that is unexpected, check its brief in the CEO tab.'
    }
    if ((ctx.leadsTotal ?? 0) === 0) {
      return `Nothing is in the CRM yet. Import your ${ctx.leadMany} or share your WhatsApp link so tomorrow has something to work.`
    }
    return 'If you expected work today, check whether the daily routine is on in the CEO tab.'
  }
  if (ctx.att > 0 && ctx.connections === 0) {
    return 'Calls were attempted and none connected. Check those numbers before calling again.'
  }
  if ((ctx.assetsFailed ?? 0) > 0) {
    return 'Some files failed to render. Retry them from the library.'
  }
  return null
}

/* ------------------------------------------------------------------ */
/* WhatsApp text — the same facts, terse                              */
/* ------------------------------------------------------------------ */

function buildWhatsappText(ctx: {
  businessName: string
  positioning: string
  dateLabel: string
  headline: string
  activityFacts: string[]
  productionFacts: string[]
  pipelineFacts: string[]
  campaignFacts: string[]
  costFacts: string[]
  nextStep: string | null
  dashboardUrl: string
}): string {
  const blocks: string[] = []
  blocks.push(`*${ctx.businessName}* — end of day, ${ctx.dateLabel}`)
  if (ctx.positioning) blocks.push(ctx.positioning)
  blocks.push(ctx.headline)
  blocks.push(ctx.activityFacts.join('\n'))
  if (ctx.productionFacts.length) blocks.push(ctx.productionFacts.join('\n'))
  if (ctx.pipelineFacts.length) blocks.push(ctx.pipelineFacts.join('\n'))
  if (ctx.campaignFacts.length) blocks.push(ctx.campaignFacts.join('\n'))
  if (ctx.costFacts.length) blocks.push(ctx.costFacts.join('\n'))
  if (ctx.nextStep) blocks.push(`Next: ${ctx.nextStep}`)
  if (ctx.dashboardUrl) blocks.push(ctx.dashboardUrl)
  return blocks.filter(Boolean).join('\n\n')
}

/* ------------------------------------------------------------------ */
/* Email HTML — plain, phone-first, inline styles                      */
/* ------------------------------------------------------------------ */

function buildHtml(ctx: {
  businessName: string
  positioning: string
  dateLabel: string
  headline: string
  sentiment: EodSentiment
  metrics: EodMetric[]
  sections: EodSection[]
}): string {
  const accent =
    ctx.sentiment === 'quiet'
      ? '#6b7280'
      : ctx.sentiment === 'attention'
        ? '#b45309'
        : ctx.sentiment === 'good'
          ? '#059669'
          : '#2563eb'

  const metricCells = ctx.metrics
    .map(
      (m) => `<td style="padding:10px 12px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;vertical-align:top;">
          <span style="display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;font-weight:700;">${esc(m.label)}</span>
          <strong style="display:block;font-size:20px;color:#111827;margin-top:2px;">${esc(m.value)}</strong>
          ${m.hint ? `<span style="display:block;font-size:11px;color:#9ca3af;">${esc(m.hint)}</span>` : ''}
        </td>`
    )
    .join('<td style="width:8px;"></td>')

  const metricsHtml = metricCells
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 22px;"><tr>${metricCells}</tr></table>`
    : ''

  const sectionsHtml = ctx.sections
    .map((section) => {
      const lines = section.lines
        .map(
          (line) => `<tr>
            <td style="padding:5px 0;vertical-align:top;width:12px;color:${accent};font-weight:700;">•</td>
            <td style="padding:5px 0;vertical-align:top;font-size:14px;color:#1f2937;line-height:21px;">${esc(line)}</td>
          </tr>`
        )
        .join('')
      const rows = (section.rows || [])
        .map(
          (row) => `<tr>
            <td style="padding:5px 0;font-size:13px;color:#374151;">${esc(row.label)}</td>
            <td style="padding:5px 0;font-size:13px;color:#111827;font-weight:700;text-align:right;">${esc(row.value)}</td>
          </tr>`
        )
        .join('')
      return `<div style="margin:0 0 20px;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:700;">${esc(section.title)}</p>
        ${lines ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${lines}</table>` : ''}
        ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:6px;border-top:1px solid #f3f4f6;">${rows}</table>` : ''}
      </div>`
    })
    .join('')

  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <div style="padding:20px 22px;border-bottom:1px solid #eef0f3;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:700;">End of day · ${esc(ctx.dateLabel)}</p>
      <h1 style="margin:0;font-size:19px;color:#111827;">${esc(ctx.businessName)}</h1>
      ${ctx.positioning ? `<p style="margin:4px 0 0;font-size:13px;color:#4b5563;">${esc(ctx.positioning)}</p>` : ''}
    </div>
    <div style="padding:20px 22px;">
      <p style="margin:0 0 16px;font-size:15px;color:${accent};font-weight:700;">${esc(ctx.headline)}</p>
      ${metricsHtml}
      ${sectionsHtml}
    </div>
    <div style="padding:14px 22px;border-top:1px solid #eef0f3;background:#fafafa;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">Daily reports are on for this workspace. Change that in profile settings.</p>
    </div>
  </div>
</body></html>`
}

/* ------------------------------------------------------------------ */
/* Worker helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * The ledger description used to charge for this report. Contains the tenant's
 * local day, so a retried worker finds the existing row and does not charge twice.
 */
export function eodChargeDescription(periodKey: string): string {
  return `Daily EOD report email (${periodKey})`
}

/** Statuses that mean an asset is finished rather than still rendering. */
export const ASSET_READY_STATUSES = ['ready', 'completed', 'complete', 'done', 'delivered', 'published', 'approved']

export function isAssetReady(status?: string | null): boolean {
  const value = String(status || '').trim().toLowerCase()
  return ASSET_READY_STATUSES.includes(value)
}

export function isAssetFailed(status?: string | null): boolean {
  const value = String(status || '').trim().toLowerCase()
  return value === 'failed' || value === 'error'
}

/** Sum the negative rows of today's credit ledger. Null only when it was unreadable. */
export function sumCreditSpend(rows: Array<{ amount?: number | string | null }> | null | undefined): number | null {
  if (!Array.isArray(rows)) return null
  let total = 0
  for (const row of rows) {
    const n = amount(row?.amount)
    if (n == null) continue
    if (n < 0) total += Math.abs(n)
  }
  return Math.round(total * 100) / 100
}
