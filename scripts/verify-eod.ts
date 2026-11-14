/* eslint-disable @typescript-eslint/no-explicit-any --
 * Test harness: the report input is assembled from untyped Supabase rows.
 *//**
 * EOD report content: pure, offline, and honest.
 *
 *   npx esbuild scripts/verify-eod.ts --bundle --platform=node --format=cjs \
 *     --outfile=.tmp-eod.cjs --log-level=warning && node .tmp-eod.cjs
 *
 * No database, no network, no vendor calls: `buildEodReport` is a pure function,
 * so every check here is a statement about what a client would read.
 *
 * What is checked:
 *   1. the module is pure (no Supabase import, no clock of its own)
 *   2. a zero day reads as a zero day, with one concrete next step and no filler
 *   3. industry vocabulary switches (real estate vs education) and NULL is neutral
 *   4. calls separate attempted / connected / failed, and never claim a completed call
 *   5. nothing produced means the production section is omitted, not "0 creatives"
 *   6. "today" is a local day in the tenant timezone, not now minus 24 hours
 *   7. WhatsApp and the email carry the same numbers
 *   8. every number comes from the input (distinct sentinels, exact placement)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  buildEodReport,
  dayWindow,
  classifyInstant,
  summarizeCallHistory,
  eodChargeDescription,
  isAssetReady,
  sumCreditSpend,
  type EodReportInput,
} from '../lib/automation/eod-report'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(name + (detail ? ` — ${detail}` : ''))
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const IST = 'Asia/Kolkata'
/** 12 Nov 2026, 19:00 IST — a normal evening EOD run. */
const EVENING = new Date('2026-11-12T13:30:00.000Z')

function base(over: Partial<EodReportInput> = {}): EodReportInput {
  return {
    now: EVENING,
    timezone: IST,
    currency: 'INR',
    businessName: 'Test Workspace',
    industry: null,
    positioning: null,
    dashboardUrl: 'https://app.nobogent.com/dashboard',
    leads: { total: 0, newToday: 0, newPreviousDay: 0, pipeline: [] },
    whatsapp: { totalToday: 0, inboundToday: 0, outboundToday: 0, previousDayTotal: 0 },
    calls: { attempted: 0, connected: 0, failed: 0 },
    production: { creatives: 0, videos: 0, assetsReady: 0, assetsFailed: 0, pagesPublished: 0, sitesBuilt: 0 },
    credits: { spentToday: 0, balance: null },
    ...over,
  }
}

const REAL_ESTATE_WORDS = [
  'propert',
  'listing',
  'rera',
  'site visit',
  'carpet area',
  'bhk',
  'apartment',
  'realtor',
  'real estate',
  'realty',
  'brokerage',
]

/** Everything a client could read, in one lowercased blob. */
function readable(input: EodReportInput): string {
  const report = buildEodReport(input)
  const sections = report.sections
    .map((s) => `${s.title}\n${s.lines.join('\n')}\n${(s.rows || []).map((r) => `${r.label} ${r.value}`).join('\n')}`)
    .join('\n')
  return `${report.subject}\n${report.headline}\n${sections}\n${report.whatsappText}\n${report.html}`.toLowerCase()
}

/* ------------------------------------------------------------------ */
/* 1. purity                                                           */
/* ------------------------------------------------------------------ */
function testPurity() {
  console.log('\n— module purity —')
  // The bundle is written next to the repo root, so try the script's own location
  // first and fall back to the working directory.
  const candidates = [
    path.join(__dirname, 'lib', 'automation', 'eod-report.ts'),
    path.join(__dirname, '..', 'lib', 'automation', 'eod-report.ts'),
    path.resolve(process.cwd(), 'lib', 'automation', 'eod-report.ts'),
  ]
  const srcPath = candidates.find((p) => fs.existsSync(p))
  check('the module source is readable', !!srcPath, candidates.join(' | '))
  if (!srcPath) return
  const src = fs.readFileSync(srcPath, 'utf8')
  // Strip comments first: the docstring explains what the module deliberately does
  // NOT do, and prose about `Date.now()` is not a call to it.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  check('module does not import Supabase', !/supabase/i.test(code))
  check('module never reads the clock', !/Date\.now\s*\(/.test(code))
  check('module takes now as an input', /now:\s*Date/.test(code))

  const report = buildEodReport(base())
  check('pure: same input yields identical output', JSON.stringify(buildEodReport(base())) === JSON.stringify(report))
}

/* ------------------------------------------------------------------ */
/* 2. a zero day                                                       */
/* ------------------------------------------------------------------ */
function testQuietDay() {
  console.log('\n— a zero day says so —')
  const report = buildEodReport(
    base({ credits: { spentToday: 0, balance: 900 } })
  )
  const activity = report.sections.find((s) => s.key === 'activity')
  const allText = `${report.headline}\n${report.whatsappText}\n${report.html}`.toLowerCase()

  check('quiet sentiment', report.sentiment === 'quiet', report.sentiment)
  check('headline says nothing came in', /nothing came in today/i.test(report.headline), report.headline)
  check('no "productive day" phrasing survives', !/productive/i.test(allText))
  check('no "today was" openers', !/today was/i.test(allText))
  check('activity is a single plain sentence', (activity?.lines.length || 0) === 1, JSON.stringify(activity?.lines))
  check(
    'that sentence says nothing happened',
    /^No new .*no WhatsApp messages, no calls and nothing produced\.$/.test(activity?.lines[0] || ''),
    activity?.lines[0]
  )
  check('no fabricated count anywhere', !/\b\d+\s+(new|call|calls|creative|creatives|message|messages)\b/.test(
    `${activity?.lines.join(' ')} ${report.headline}`
  ), `${activity?.lines.join(' ')} | ${report.headline}`)
  const next = report.sections.find((s) => s.key === 'next')
  check('exactly one next step is offered', (next?.lines.length || 0) === 1, JSON.stringify(next?.lines))
  check('the next step is concrete', /(CEO tab|CRM|WhatsApp link)/.test(next?.lines[0] || ''), next?.lines[0])
  check(
    'no zero-valued metric cards',
    !report.metrics.some((m) => ['new_leads', 'calls', 'produced', 'whatsapp'].includes(m.key)),
    JSON.stringify(report.metrics)
  )
  check('production section omitted on a zero day', !report.sections.some((s) => s.key === 'production'))
}

/* ------------------------------------------------------------------ */
/* 3. industry vocabulary                                              */
/* ------------------------------------------------------------------ */
const SAME_NUMBERS = {
  leads: {
    total: 40,
    newToday: 2,
    newPreviousDay: 1,
    pipeline: [{ stage: 'New', count: 30 }],
  },
  whatsapp: { totalToday: 6, inboundToday: 4, outboundToday: 2, previousDayTotal: 5 },
  calls: { attempted: 1, connected: 1, failed: 0 },
  production: { creatives: 1, videos: 0, assetsReady: 1, assetsFailed: 0, pagesPublished: 0, sitesBuilt: 0 },
  credits: { spentToday: 7, balance: 500 },
} as const

function testIndustries() {
  console.log('\n— industry vocabulary —')
  const re = readable(base({ ...(SAME_NUMBERS as any), industry: 'real_estate', businessName: 'Blue Square Infra' }))
  const edu = readable(base({ ...(SAME_NUMBERS as any), industry: 'education', businessName: 'Lumen Film Academy' }))
  const unknown = readable(base({ ...(SAME_NUMBERS as any), industry: null, businessName: 'Untagged Co' }))
  const alsoUnknown = readable(base({ ...(SAME_NUMBERS as any), industry: 'quantum-basket-weaving', businessName: 'Untagged Co' }))

  check('real estate output uses property vocabulary', /enquir|listing/.test(re), re.slice(0, 200))
  check('education output does not use the real-estate lead word', /applicant/.test(edu) && !/enquir/.test(edu))
  check('the two verticals do not produce identical text', re !== edu)
  check(
    'education output carries no real-estate words',
    REAL_ESTATE_WORDS.every((w) => !edu.includes(w)),
    REAL_ESTATE_WORDS.filter((w) => edu.includes(w)).join(',')
  )
  check(
    'NULL industry carries no real-estate words',
    REAL_ESTATE_WORDS.every((w) => !unknown.includes(w)),
    REAL_ESTATE_WORDS.filter((w) => unknown.includes(w)).join(',')
  )
  check(
    'unknown industry behaves like NULL (neutral)',
    unknown === alsoUnknown,
    'an unrecognised industry string must not fall back to real estate'
  )
  check('neutral output uses plain CRM vocabulary', /leads/.test(unknown) && !/enquir/.test(unknown))
  check(
    'education output does not mention courses it does not sell to real estate',
    edu.includes('applicants') && re.includes('enquiries'),
    `edu=${/applicants/.test(edu)} re=${/enquiries/.test(re)}`
  )
}

/* ------------------------------------------------------------------ */
/* 4. voice calls                                                      */
/* ------------------------------------------------------------------ */
function testCalls() {
  console.log('\n— voice calls: attempted vs connected —')
  const agentOnly = JSON.stringify({ summary: '', transcript: [{ role: 'agent', message: 'Hello, is this a good time?' }] })
  const leadSpoke = JSON.stringify({
    summary: 'Lead asked about pricing',
    transcript: [
      { role: 'agent', message: 'Hello?' },
      { role: 'user', message: 'Yes, tell me the fees' },
    ],
  })
  const noAnswer = JSON.stringify({ status: 'no_answer', transcript: [] })
  const explicitDone = JSON.stringify({ call_status: 'completed', transcript: [] })

  const tally = summarizeCallHistory([
    { description: `🎙️ CALL_JSON:${agentOnly}` },
    { description: `🎙️ CALL_JSON:${agentOnly}` },
    { description: `🎙️ CALL_JSON:${agentOnly}` },
    { description: 'not a call log' },
  ])
  check('a log row counts as an attempt', tally.attempted === 3, JSON.stringify(tally))
  check('an agent-only call is never counted as connected', tally.connected === 0, JSON.stringify(tally))
  check('an agent-only call is counted as failed', tally.failed === 3, JSON.stringify(tally))

  const tally2 = summarizeCallHistory([
    { description: `🎙️ CALL_JSON:${leadSpoke}` },
    { description: `🎙️ CALL_JSON:${noAnswer}` },
    { description: `🎙️ CALL_JSON:${explicitDone}` },
    { description: '🎙️ CALL_JSON:{not json' },
  ])
  check('a lead who spoke is connected', tally2.connected === 2, JSON.stringify(tally2))
  check('an explicit no-answer is failed', tally2.failed === 1, JSON.stringify(tally2))
  check('malformed json is an attempt, never a connection', tally2.attempted === 4 && tally2.failed + tally2.connected === 3, JSON.stringify(tally2))

  const report = buildEodReport(base({ calls: { attempted: 3, connected: 0, failed: 3 } }))
  const callsSection = report.sections.find((s) => s.key === 'activity')
  const callsLine = (callsSection?.lines || []).find((l) => /calls? attempted/i.test(l)) || ''
  const everything = `${report.headline}\n${report.whatsappText}\n${report.html}`.toLowerCase()

  check('the line reports attempts', /3 calls attempted/.test(callsLine), callsLine)
  check('the line does not claim a connection', /none connected/.test(callsLine), callsLine)
  check('the word "completed" is never applied to calls', !/completed/.test(callsLine), callsLine)
  check('no "3 calls completed" claim in either channel', !/calls? completed/.test(everything))
  check('the calls metric shows 0 connected of 3', report.metrics.some((m) => m.key === 'calls' && m.value === '0 / 3'), JSON.stringify(report.metrics))
  check('attempted-and-failed day is flagged for attention', report.sentiment === 'attention', report.sentiment)

  const zero = buildEodReport(base({ calls: { attempted: 0, connected: 0, failed: 0 } }))
  check('zero calls produce no call metric', !zero.metrics.some((m) => m.key === 'calls'), JSON.stringify(zero.metrics))
  check('zero calls never appear as "0 calls completed"', !/0 calls?/.test(zero.whatsappText.toLowerCase()))
}

/* ------------------------------------------------------------------ */
/* 5. production                                                       */
/* ------------------------------------------------------------------ */
function testProduction() {
  console.log('\n— what the department produced —')

  const none = buildEodReport(
    base({
      leads: { total: 5, newToday: 1, newPreviousDay: 0, pipeline: [] },
      whatsapp: { totalToday: 2, inboundToday: 1, outboundToday: 1, previousDayTotal: 0 },
      production: { creatives: 0, videos: 0, assetsReady: 0, assetsFailed: 0, pagesPublished: 0, sitesBuilt: 0 },
      credits: { spentToday: 0, balance: 100 },
    })
  )
  check('no production section when nothing was produced', !none.sections.some((s) => s.key === 'production'))
  check(
    'no "0 creatives" boilerplate anywhere',
    !/0 (creative|creatives|video|videos|assets|landing page)/i.test(`${none.html} ${none.whatsappText} ${none.headline}`)
  )

  const some = buildEodReport(
    base({
      production: { creatives: 358, videos: 193, assetsReady: 246, assetsFailed: 0, pagesPublished: 168, sitesBuilt: 137 },
      credits: { spentToday: 941, balance: 855 },
    })
  )
  const produced = some.sections.find((s) => s.key === 'production')
  check('production section appears when work happened', !!produced, JSON.stringify(some.sections.map((s) => s.key)))
  const text = (produced?.lines || []).join(' ')
  check('it counts creatives', /358 creatives made/.test(text), text)
  check('it counts videos', /193 videos made/.test(text), text)
  check('it counts finished files', /246 files finished and ready to use/.test(text), text)
  check('it counts pages', /168 landing pages published/.test(text), text)
  check('it counts websites', /137 websites built/.test(text), text)
  check('delivery is reported in both channels', some.whatsappText.includes('246 files finished and ready to use.'), some.whatsappText)
  check('produced assets are mirrored in the metrics', some.metrics.some((m) => m.key === 'produced' && m.value === '856'), JSON.stringify(some.metrics))

  const failuresOnly = buildEodReport(
    base({ production: { creatives: 2, videos: 0, assetsReady: 0, assetsFailed: 3, pagesPublished: 0, sitesBuilt: 0 } })
  )
  const failedLine = (failuresOnly.sections.find((s) => s.key === 'production')?.lines || []).join(' ')
  check('a render failure is reported', /3 files failed to render/.test(failedLine), failedLine)
  check('a day with failures needs attention', failuresOnly.sentiment === 'attention', failuresOnly.sentiment)

  check('asset status mapping', isAssetReady('READY') && isAssetReady('completed') && !isAssetReady('Rendering'))
  check('credit spend sums only deductions', sumCreditSpend([{ amount: -5 }, { amount: -2.5 }, { amount: 100 }]) === 7.5, String(sumCreditSpend([{ amount: -5 }, { amount: -2.5 }, { amount: 100 }])))
  check('credit spend of an empty ledger is 0', sumCreditSpend([]) === 0, String(sumCreditSpend([])))
  check('credit spend of an unreadable ledger is null', sumCreditSpend(null) === null)
}

/* ------------------------------------------------------------------ */
/* 6. timezone                                                         */
/* ------------------------------------------------------------------ */
function testTimezone() {
  console.log('\n— the local day is the tenant’s day —')
  // 00:30 IST on 12 Nov 2026 == 19:00Z on 11 Nov.
  const justAfterMidnight = new Date('2026-11-11T19:00:00.000Z')
  const win = dayWindow(justAfterMidnight, IST)

  check('the window starts at local midnight', win.start.toISOString() === '2026-11-11T18:30:00.000Z', win.start.toISOString())
  check(
    'the window is not "now minus 24 hours"',
    justAfterMidnight.getTime() - win.start.getTime() === 30 * 60_000,
    `${(justAfterMidnight.getTime() - win.start.getTime()) / 60_000} minutes`
  )
  check('the previous day window ends where today starts', win.previousStart.toISOString() === '2026-11-10T18:30:00.000Z', win.previousStart.toISOString())
  check('the window ends at the next local midnight', win.end.toISOString() === '2026-11-12T18:30:00.000Z', win.end.toISOString())
  check('the period key is the local date', win.periodKey === '2026-11-12', win.periodKey)
  check('the date label is the local date in en-IN', /12 November 2026/.test(win.dateLabel), win.dateLabel)

  // 23:15 IST on the 11th is the PREVIOUS day, even though it is 55 minutes ago.
  check(
    'a late-evening row from yesterday is not today',
    classifyInstant('2026-11-11T17:45:00.000Z', win) === 'previous',
    classifyInstant('2026-11-11T17:45:00.000Z', win)
  )
  check(
    'a row after local midnight is today',
    classifyInstant('2026-11-11T19:15:00.000Z', win) === 'today',
    classifyInstant('2026-11-11T19:15:00.000Z', win)
  )
  check('a two-day-old row is outside', classifyInstant('2026-11-10T10:00:00.000Z', win) === 'outside')
  check('a missing timestamp is outside', classifyInstant(null, win) === 'outside')

  // The row from 23:15 yesterday must not be reported as today's row.
  const report = buildEodReport(
    base({
      now: justAfterMidnight,
      leads: { total: 1, newToday: 0, newPreviousDay: 1, pipeline: [{ stage: 'New', count: 1 }] },
      // Something else happened today, so the day is not quiet and the lead line is explicit.
      whatsapp: { totalToday: 1, inboundToday: 1, outboundToday: 0, previousDayTotal: 0 },
      credits: { spentToday: 0, balance: 10 },
    })
  )
  const activity = (report.sections.find((s) => s.key === 'activity')?.lines || []).join(' ')
  check('yesterday’s row is not attributed to today', /No new leads today\./.test(activity), activity)
  check('the report is dated in the tenant timezone', report.dateLabel === '12 November 2026', report.dateLabel)
  check('the previous day is only used as context, never as today’s work', /1 the day before/.test(activity) === false, activity)

  // A different timezone must produce a different day boundary for the same instant.
  const dubai = dayWindow(justAfterMidnight, 'Asia/Dubai')
  check('timezones are honoured', dubai.start.toISOString() !== win.start.toISOString(), dubai.start.toISOString())
  check('an invalid timezone falls back safely', dayWindow(justAfterMidnight, 'Mars/Olympus').periodKey === '2026-11-12')
}

/* ------------------------------------------------------------------ */
/* 7. both channels, same story                                        */
/* ------------------------------------------------------------------ */
function testChannelParity() {
  console.log('\n— WhatsApp and email agree —')
  const report = buildEodReport(
    base({
      businessName: 'Blue Square Infra',
      industry: 'real_estate',
      positioning: 'Verified Whitefield listings',
      leads: { total: 617, newToday: 831, newPreviousDay: 512, pipeline: [{ stage: 'New', count: 590 }] },
      whatsapp: { totalToday: 449, inboundToday: 327, outboundToday: 122, previousDayTotal: 300 },
      calls: { attempted: 386, connected: 274, failed: 112 },
      production: { creatives: 358, videos: 193, assetsReady: 246, assetsFailed: 0, pagesPublished: 168, sitesBuilt: 137 },
      credits: { spentToday: 941, balance: 855 },
    })
  )

  check('every fact line is in the email', report.facts.every((f) => report.html.includes(f)), report.facts.filter((f) => !report.html.includes(f)).join(' | '))
  check('every fact line is in the WhatsApp text', report.facts.every((f) => report.whatsappText.includes(f)), report.facts.filter((f) => !report.whatsappText.includes(f)).join(' | '))
  check('the headline is in both channels', report.html.includes(report.headline) && report.whatsappText.includes(report.headline))
  check('the headline numbers are the same numbers', ['831', '449', '274', '856'].every((n) => report.whatsappText.includes(n) && report.html.includes(n)))
  check('positioning addresses the business', report.html.includes('Verified Whitefield listings') && report.whatsappText.includes('Verified Whitefield listings'))
  check('the WhatsApp text stays readable in one bubble', report.whatsappText.length < 1200, `${report.whatsappText.length} chars`)
  check('the WhatsApp text is not emoji soup', (report.whatsappText.match(/\p{Extended_Pictographic}/gu) || []).length <= 2)
  check('the subject names the business and the day', /Blue Square Infra/.test(report.subject) && /12 November 2026/.test(report.subject), report.subject)
}

/* ------------------------------------------------------------------ */
/* 8. no invented numbers                                              */
/* ------------------------------------------------------------------ */
function testNoInvention() {
  console.log('\n— every number comes from the input —')
  const S = {
    newLeads: 831,
    leadsTotal: 617,
    leadsPrev: 512,
    waTotal: 449,
    waIn: 327,
    waOut: 122,
    callsAttempted: 386,
    callsConnected: 274,
    creatives: 358,
    ready: 246,
    videos: 193,
    pages: 168,
    sites: 137,
    spent: 941,
    balance: 855,
  }
  const report = buildEodReport(
    base({
      leads: { total: S.leadsTotal, newToday: S.newLeads, newPreviousDay: S.leadsPrev, pipeline: [{ stage: 'New Lead', count: S.leadsTotal - 7 }] },
      whatsapp: { totalToday: S.waTotal, inboundToday: S.waIn, outboundToday: S.waOut, previousDayTotal: 300 },
      calls: { attempted: S.callsAttempted, connected: S.callsConnected, failed: S.callsAttempted - S.callsConnected },
      production: { creatives: S.creatives, videos: S.videos, assetsReady: S.ready, assetsFailed: 0, pagesPublished: S.pages, sitesBuilt: S.sites },
      credits: { spentToday: S.spent, balance: S.balance },
    })
  )

  const byKey = (k: string) => report.metrics.find((m) => m.key === k)
  check('new-lead metric is the input number', byKey('new_leads')?.value === String(S.newLeads), JSON.stringify(byKey('new_leads')))
  check('WhatsApp metric is the input number', byKey('whatsapp')?.value === String(S.waTotal), JSON.stringify(byKey('whatsapp')))
  check('calls metric is connected of attempted', byKey('calls')?.value === `${S.callsConnected} / ${S.callsAttempted}`, JSON.stringify(byKey('calls')))
  check('balance metric is the input number', byKey('credits')?.value === String(S.balance), JSON.stringify(byKey('credits')))

  const activity = (report.sections.find((s) => s.key === 'activity')?.lines || []).join(' ')
  const pipeline = (report.sections.find((s) => s.key === 'pipeline')?.lines || []).join(' ')
  const cost = (report.sections.find((s) => s.key === 'cost')?.lines || []).join(' ')

  check('leads today appear in the activity section', activity.includes(String(S.newLeads)), activity)
  check('the previous day appears only as context', activity.includes(String(S.leadsPrev)) && activity.includes('the day before'), activity)
  check('the CRM total appears in the pipeline section, not the activity one', pipeline.includes(String(S.leadsTotal)) && !activity.includes(String(S.leadsTotal)))
  check('inbound and outbound are both reported', activity.includes(String(S.waIn)) && activity.includes(String(S.waOut)), activity)
  check('attempts and connections are both reported', activity.includes(String(S.callsAttempted)) && activity.includes(String(S.callsConnected)), activity)
  check('credits spent and balance appear in the cost section', cost.includes(String(S.spent)) && cost.includes(String(S.balance)), cost)
  check('balances are not smuggled into the activity section', !activity.includes(String(S.balance)))

  const everyNumber = Object.values(S).map(String)
  check(
    'every input number is rendered somewhere',
    everyNumber.every((n) => report.html.includes(n) && report.whatsappText.includes(n)),
    everyNumber.filter((n) => !report.html.includes(n) || !report.whatsappText.includes(n)).join(',')
  )
  check(
    'no number is invented',
    !/\b\d{4,}\b/.test(report.whatsappText.replace(/https?:\/\/\S+/g, '').replace(/\b(19|20)\d{2}\b/g, '')),
    'the only four-digit numbers allowed are the year in the date'
  )

  // Omitted facts must stay omitted.
  const sparse = buildEodReport(
    base({
      leads: { total: null, newToday: null, newPreviousDay: null, pipeline: null },
      whatsapp: null,
      calls: null,
      production: null,
      credits: null,
    })
  )
  check('an empty input produces no metric cards', sparse.metrics.length === 0, JSON.stringify(sparse.metrics))
  check('an empty input invents no totals', !/\d/.test(sparse.facts.join(' ').replace(/No new [a-z ]+/, '')), sparse.facts.join(' | '))
  check('an empty input is still a complete report', sparse.html.length > 500 && sparse.whatsappText.length > 40)
  check('an empty input still names the business', sparse.html.includes('Test Workspace'))

  // Escaping: a hostile business name must not become markup.
  const hostile = buildEodReport(base({ businessName: '<script>alert(1)</script>' }))
  check('business name is escaped in the email', !hostile.html.includes('<script>alert(1)</script>'))
  check('the name still appears as text in the subject', hostile.subject.includes('script'), hostile.subject)
  check('no unescaped angle brackets from tenant text', !/<script/i.test(hostile.html))
}

/* ------------------------------------------------------------------ */
/* 9. routine + campaigns + playbook                                   */
/* ------------------------------------------------------------------ */
function testRoutineAndCampaigns() {
  console.log('\n— routine, ads, and the playbook —')

  const on = buildEodReport(
    base({
      routine: { enabled: true, name: 'Daily marketing', cadence: 'daily', todayRunStatus: 'completed', lastRunAt: '2026-11-12T03:30:00.000Z' },
      dailyRoutineJobs: [{ kind: 'creative', at: '09:00' }, { kind: 'video', everyDays: 3 }],
    })
  )
  const routineText = (on.sections.find((s) => s.key === 'routine')?.lines || []).join(' ')
  check('routine state is reported', /daily routine is on/i.test(routineText), routineText)
  check('today’s run status is reported', /Today's run: completed\./.test(routineText), routineText)
  check('the planned work is described', /creative at 09:00/.test(routineText) && /video every 3 days/.test(routineText), routineText)

  const off = buildEodReport(base({ routine: { enabled: false, cadence: 'daily' } }))
  const offText = (off.sections.find((s) => s.key === 'routine')?.lines || []).join(' ')
  check('a switched-off routine is stated plainly', /switched off/i.test(offText), offText)
  check('a switched-off routine is named as the next step', /Turn it on in the CEO tab/.test((off.sections.find((s) => s.key === 'next')?.lines || []).join(' ')))

  const missing = buildEodReport(
    base({
      // Some activity, so the day is not quiet and the missing run is the problem.
      whatsapp: { totalToday: 4, inboundToday: 3, outboundToday: 1, previousDayTotal: 2 },
      routine: { enabled: true, cadence: 'daily', todayRunStatus: null },
    })
  )
  const missingText = (missing.sections.find((s) => s.key === 'routine')?.lines || []).join(' ')
  check('a missing run is not invented as success', /No run is recorded for today/.test(missingText), missingText)
  check('a missing run needs attention', missing.sentiment === 'attention', missing.sentiment)

  const noRoutine = buildEodReport(base({ routine: null }))
  check('no routine table means no routine section', !noRoutine.sections.some((s) => s.key === 'routine'))

  const ads = buildEodReport(
    base({
      campaigns: { total: 3, active: 2, spendToDate: 1200.5, results: 47 },
      industry: 'education',
    })
  )
  const adsText = (ads.sections.find((s) => s.key === 'campaigns')?.lines || []).join(' ')
  check('campaign state is counted', /2 of 3 campaigns running\./.test(adsText), adsText)
  check('spend is formatted for India', /₹1,200\.5/.test(adsText), adsText)
  check('Meta results are called results, not leads or applicants', /Meta reports 47 results\./.test(adsText), adsText)
  check('the report never relabels Meta results as leads', !/results? (as|are) .*leads/i.test(adsText) && !/\d+ leads\b/i.test(adsText), adsText)
  check(
    'the industry word is used when it is true',
    /not applicants in your CRM|not enquiries in your CRM/.test(adsText),
    adsText
  )

  const noAds = buildEodReport(base({ campaigns: null }))
  check('no ad account means no ads section', !noAds.sections.some((s) => s.key === 'campaigns'))
  check(
    'ad facts reach both channels',
    ads.facts.every((f) => ads.html.includes(f) && ads.whatsappText.includes(f)),
    ads.facts.filter((f) => !ads.whatsappText.includes(f)).join(' | ')
  )
}

/* ------------------------------------------------------------------ */
/* 10. worker helpers                                                  */
/* ------------------------------------------------------------------ */
function testWorkerHelpers() {
  console.log('\n— worker helpers —')
  const a = eodChargeDescription('2026-11-12')
  const b = eodChargeDescription('2026-11-12')
  const c = eodChargeDescription('2026-11-13')
  check('the charge description is stable for a day', a === b, a)
  check('the charge description changes with the day', a !== c)
  check('the charge description names the day', a.includes('2026-11-12'), a)
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */
function main() {
  testPurity()
  testQuietDay()
  testIndustries()
  testCalls()
  testProduction()
  testTimezone()
  testChannelParity()
  testNoInvention()
  testRoutineAndCampaigns()
  testWorkerHelpers()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`passed ${passed}   failed ${failed}`)
  if (failed) {
    console.log('\nfailures:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('ALL EOD REPORT CHECKS PASSED')
}

main()
