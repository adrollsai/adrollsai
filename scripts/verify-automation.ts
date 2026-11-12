/* eslint-disable @typescript-eslint/no-explicit-any --
 * Test harness: rows come back untyped from Supabase (stale generated types),
 * so assertion helpers accept `any`.
 *//**
 * Verification suite for the marketing-automation system.
 *
 *   npm run verify:automation
 *
 * Covers the pure logic (cadence, billing, site builder) with no I/O, and the
 * database contract (claim functions, candidate query, enqueue idempotency)
 * against the live project. Mutating DB checks revert everything they touch.
 */

import * as fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

import {
  evaluateCadence,
  DEFAULT_CALL_CADENCE_HOURS,
  localHour,
  isWithinCallWindow,
  atLocalTime,
} from '../lib/automation/calling-cadence'
import { canAffordAutomation, creditBalance, resolveBillingOwner } from '../lib/automation/billing'
import {
  buildSiteHtml,
  siteBaseUrl,
  __resetTemplateCache,
  type SiteProfile,
  type SiteProperty,
} from '../lib/automation/site-builder'

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

function eq<T>(name: string, actual: T, expected: T) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`)
}

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    for (const [k, v] of Object.entries(process.env)) if (v) out[k] = v
  }
  return out
}

const IST = 'Asia/Kolkata'
const H = 3_600_000

/* ====================================================================== */
/* 1. CALLING CADENCE                                                     */
/* ====================================================================== */
function testCadence() {
  console.log('\n— cadence engine —')
  const now = new Date('2026-11-11T06:00:00.000Z') // 11:30 IST
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * H)

  eq('default cadence has 15 slots', DEFAULT_CALL_CADENCE_HOURS.length, 15)

  // slot 1 (+1h) already passed
  let d = evaluateCadence({ createdAt: at(2), attemptCount: 0, now })
  check('slot 1 due for a 2h-old lead', d.isDue, d.reason)

  // slot 1 (+1h) not reached yet
  d = evaluateCadence({ createdAt: at(0.5), attemptCount: 0, now })
  check('slot 1 not due for a 30min-old lead', !d.isDue, d.reason)

  // slot 2 is +3h
  d = evaluateCadence({ createdAt: at(2), attemptCount: 1, now })
  check('slot 2 not due at 2h', !d.isDue, d.reason)
  d = evaluateCadence({ createdAt: at(4), attemptCount: 1, now })
  check('slot 2 due at 4h', d.isDue, d.reason)

  // midnight cross must clamp into the 09:00 window
  const lateNight = new Date('2026-11-10T17:30:00.000Z') // 23:00 IST
  d = evaluateCadence({ createdAt: lateNight, attemptCount: 0, now: new Date('2026-11-10T17:35:00.000Z') })
  check('midnight slot clamps to 09:00 IST', d.dueAt !== null && localHour(d.dueAt, IST) === 9, String(d.dueAt))

  // tail interval after the table is exhausted
  d = evaluateCadence({ createdAt: at(200 * 24), attemptCount: 99, lastAttemptAt: at(40 * 24), now })
  check('tail interval fires after 30 days', d.isDue && d.reason === 'tail_interval', d.reason)
  d = evaluateCadence({ createdAt: at(200 * 24), attemptCount: 99, lastAttemptAt: at(2 * 24), now })
  check('tail interval waits inside 30 days', !d.isDue, d.reason)

  // hard caps
  d = evaluateCadence({ createdAt: new Date(now.getTime() - 500 * 86_400_000), attemptCount: 3, now })
  check('age cap stops a 500-day-old lead', d.dueAt === null && d.reason === 'max_age_exceeded', d.reason)

  // an explicit human schedule always wins
  d = evaluateCadence({ createdAt: at(5), attemptCount: 0, scheduledAt: new Date(now.getTime() - 60_000), now })
  check('explicit schedule overrides cadence', d.isDue && d.reason === 'explicitly_scheduled', d.reason)

  // tenant-specific cadence override
  d = evaluateCadence({ createdAt: at(2), attemptCount: 0, now }, { cadenceHours: [6] })
  check('custom cadence override respected', !d.isDue, d.reason)

  // window helpers
  check('inside window', isWithinCallWindow(new Date('2026-11-11T06:00:00.000Z'), 9, 19, IST))
  check('outside window (22:00 IST)', !isWithinCallWindow(new Date('2026-11-11T16:30:00.000Z'), 9, 19, IST))
  eq('atLocalTime gives 09:00 IST', localHour(atLocalTime(now, 9, 0, IST), IST), 9)

  // wrapping window 22 -> 06
  check('wrap-around window includes 23:00', isWithinCallWindow(new Date('2026-11-11T17:30:00.000Z'), 22, 6, IST))
}

/* ====================================================================== */
/* 2. BILLING                                                             */
/* ====================================================================== */
function fakeDb(credits: number | null) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(_col: string, id: string) {
              return {
                maybeSingle: async () => {
                  if (table !== 'profiles') return { data: null, error: null }
                  if (credits === null) return { data: null, error: null }
                  return { data: { id, parent_id: null, agency_id: null, credits }, error: null }
                },
              }
            },
          }
        },
      }
    },
  } as any
}

async function testBilling() {
  console.log('\n— billing —')

  let r = await canAffordAutomation(fakeDb(100), 'u', 10)
  check('affords 10 of 100', r.ok && r.balance === 100)

  r = await canAffordAutomation(fakeDb(5), 'u', 10)
  check('cannot afford 10 of 5', !r.ok && r.balance === 5)

  r = await canAffordAutomation(fakeDb(0), 'u', 10)
  check('zero balance blocks', !r.ok)

  r = await canAffordAutomation(fakeDb(100), 'u', 0)
  check('zero cost always allowed', r.ok)

  // CRITICAL: an accounting failure must never stop delivery
  const broken = { from() { throw new Error('db down') } } as any
  r = await canAffordAutomation(broken, 'u', 10)
  check('fails OPEN when balance unreadable', r.ok, JSON.stringify(r))

  const bal = await creditBalance(broken, 'u')
  check('creditBalance returns null on error', bal === null)

  const owner = await resolveBillingOwner(broken, 'u')
  check('resolveBillingOwner falls back to the user', owner === 'u')
}

/* ====================================================================== */
/* 3. SITE BUILDER                                                        */
/* ====================================================================== */
function testSiteBuilder() {
  console.log('\n— site builder —')
  __resetTemplateCache()

  const profile: SiteProfile = {
    id: 'abc-123',
    business_name: 'Blue Square Infra',
    business_info: 'Premium residential developer in Bengaluru.',
    brand_color: '#1f6feb',
    contact_number: '9876543210',
    whatsapp_phone_number: '9876543210',
    address: 'Whitefield, Bengaluru',
    email: 'hello@bluesquare.in',
    mission_statement: 'Luxury living, verified.',
    custom_domain: 'bluesquare.in',
    logo_url: 'https://cdn.example/x.png',
  }
  const props: SiteProperty[] = [
    { id: 'p1', title: 'Prestige Lakeside 3BHK', price: '₹1.2 Cr', description: 'Lake-facing 3BHK with clubhouse.', image_url: 'https://cdn.example/a.jpg', status: 'Active', address: 'Whitefield' },
    { id: 'p2', title: 'Sold Out', price: '₹9 Cr', status: 'Sold' },
  ]

  const html = buildSiteHtml(profile, props)

  check('uses the real template stylesheet', html.includes('assets/css/style.css'))
  check('renders from the template, not the fallback', html.includes('siteHeader') || html.includes('real-estate-template'))
  check('title is tenant-specific', html.includes('Blue Square Infra') && !html.includes('<title>Everline'))
  check('demo brand scrubbed', !/Everline/.test(html))
  check('canonical uses tenant domain', html.includes('<link rel="canonical" href="https://bluesquare.in">'))
  check('og:url present', html.includes('property="og:url"'))
  check('JSON-LD is RealEstateAgent', html.includes('RealEstateAgent'))
  check('JSON-LD carries tenant name', /RealEstateAgent[\s\S]*Blue Square Infra|Blue Square Infra[\s\S]*RealEstateAgent/.test(html))
  check('server-rendered h1 present', html.includes('nobogent-h1'))
  check('listings server-rendered', html.includes('Prestige Lakeside 3BHK'))
  check('sold listing filtered out', !html.includes('Sold Out'))
  check('listing links to a real URL', html.includes('/properties/p1'))
  check('offer price currency is INR', html.includes('"priceCurrency":"INR"') || html.includes('"priceCurrency": "INR"'))
  check('window.SITE override precedes app.js', html.indexOf('window.SITE = Object.assign') < html.indexOf('assets/js/app.js'))
  check('descriptive alt text', html.includes('alt="Prestige Lakeside 3BHK in Bengaluru"'))
  check('whatsapp deep link with 91 prefix', html.includes('wa.me/919876543210'))
  check('no undefined leakage', !/undefined|\[object Object\]/.test(html))

  // Rendering must not depend on NEXT_PUBLIC_APP_URL being configured.
  const noLogoNoDomain = buildSiteHtml(
    { ...profile, logo_url: null, custom_domain: null, whitelabel_domain: null },
    []
  )
  check('template assets resolve without APP_URL', noLogoNoDomain.includes('/real-estate-template/assets/img/logo-mark.svg'))
  check('never invents a hardcoded platform domain', !noLogoNoDomain.includes('app.nobogent.com'))

  // XSS
  const evil = buildSiteHtml({ ...profile, business_name: '<script>alert(1)</script>' }, [])
  check('escapes script tags in business name', !evil.includes('<script>alert(1)</script>'))

  // no custom domain -> canonical falls back gracefully, never invents a domain
  const noDomain = buildSiteHtml({ ...profile, custom_domain: null, whitelabel_domain: null }, [])
  check('no custom domain still produces a page', noDomain.length > 1000)
  eq(
    'siteBaseUrl without domain is relative or configured',
    /^(https?:\/\/|\/shared\/)/.test(siteBaseUrl({ ...profile, custom_domain: null, whitelabel_domain: null })),
    true
  )

  // empty inventory must not crash
  const empty = buildSiteHtml(profile, [])
  check('empty inventory renders', empty.includes('nobogent-h1'))
}

/* ====================================================================== */
/* 4. DATABASE CONTRACT                                                   */
/* ====================================================================== */
async function testDatabase(db: any) {
  console.log('\n— database contract —')

  // try_jsonb must never throw on malformed input
  const bad = await db.rpc('try_jsonb', { t: '{not json' } as any)
  check('try_jsonb survives malformed json', !bad.error, bad.error?.message)

  // claim_calls with ids that do not exist must be a harmless no-op
  const none = await db.rpc('claim_calls', { p_ids: ['00000000-0000-0000-0000-000000000000'] })
  check('claim_calls callable and returns no rows', !none.error && (none.data?.length ?? 0) === 0, none.error?.message)
  const empty = await db.rpc('claim_calls', { p_ids: [] })
  check('claim_calls accepts an empty array', !empty.error, empty.error?.message)

  // candidate query: includes no_answer (must be retried), excludes calling
  const cands = await db.rpc('call_cadence_candidates', { p_limit: 500 })
  check('call_cadence_candidates callable', !cands.error, cands.error?.message)
  const rows = cands.data || []
  check('candidates never include an in-flight call', rows.every((r: any) => r.voice_call_status !== 'calling'))
  check('candidates are never already booked', rows.every((r: any) => !r.booked_time))
  const tenants = new Set(rows.map((r: any) => r.user_id))
  check('candidate batch is spread across tenants (fairness)', rows.length === 0 || tenants.size > 1, `tenants=${tenants.size} rows=${rows.length}`)

  // enqueue_missing_sites must be idempotent
  const first = await db.rpc('enqueue_missing_sites', { p_limit: 500 })
  check('enqueue_missing_sites callable', !first.error, first.error?.message)
  const second = await db.rpc('enqueue_missing_sites', { p_limit: 500 })
  check('enqueue_missing_sites is idempotent', (second.data ?? 0) === 0, `second returned ${second.data}`)

  // claim_site_build_jobs leases jobs. Assert the semantics, then revert every
  // row we touched — a test must never leave production state leased.
  const completed = await db.from('site_build_jobs').select('id').eq('status', 'completed').limit(1)
  const claimed = await db.rpc('claim_site_build_jobs', { p_limit: 3 })
  check('claim_site_build_jobs callable', !claimed.error, claimed.error?.message)

  const claimedRows: any[] = claimed.data || []
  if (claimedRows.length) {
    check(
      'claim sets a future lease',
      claimedRows.every((r) => r.locked_until && new Date(r.locked_until).getTime() > Date.now())
    )
    check('claim increments attempts', claimedRows.every((r) => Number(r.attempts) >= 1))

    if ((completed.data || []).length) {
      const completedId = completed.data![0].id
      check('completed jobs are never re-claimed', !claimedRows.some((r) => r.id === completedId))
    }

    for (const r of claimedRows) {
      await db
        .from('site_build_jobs')
        .update({ status: 'pending', locked_until: null, attempts: Math.max(0, Number(r.attempts) - 1) })
        .eq('id', r.id)
    }

    const after = await db
      .from('site_build_jobs')
      .select('status, locked_until')
      .in('id', claimedRows.map((r) => r.id))

    check(
      'claim state fully reverted',
      (after.data || []).every((r: any) => r.status === 'pending' && r.locked_until === null),
      JSON.stringify(after.data)
    )
  } else {
    console.log('  (no claimable jobs — lease semantics not exercised)')
  }
}

/* ====================================================================== */
/* 5. AUTOMATION CHARGING (charge_automation)                              */
/* ====================================================================== */
async function testChargeAutomation(db: any) {
  console.log('\n— automation charging —')
  const unique = `VERIFY charge ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Pick a tenant whose *owner* can afford the charge.
  const { data: candidates } = await db
    .from('profiles')
    .select('id, parent_id, agency_id')
    .limit(400)

  let target: any = null
  let ownerId: string | null = null
  let before = 0

  for (const c of candidates || []) {
    const oid = c.parent_id || c.agency_id || c.id
    const { data: owner } = await db.from('profiles').select('credits').eq('id', oid).maybeSingle()
    const bal = Number(owner?.credits ?? 0)
    if (bal >= 100) {
      target = c
      ownerId = oid
      before = bal
      break
    }
  }

  if (!target || !ownerId) {
    console.log('  (no affordable tenant — charge path not exercised)')
    return
  }

  const { data: res, error } = await db.rpc('charge_automation', {
    p_user_id: target.id,
    p_amount: 10,
    p_description: unique,
    p_category: 'ai_generation',
  })

  check('charge_automation callable', !error, error?.message)
  check('charge succeeds when funded', res?.charged === true, JSON.stringify(res))
  check('charge reports the paying owner', res?.owner === ownerId, `got ${res?.owner} want ${ownerId}`)
  check('charge returns the new balance', Number(res?.balance) === before - 10, `${res?.balance} vs ${before - 10}`)

  // ledger row must be written against the OWNER, not the team member
  const { data: ledger } = await db
    .from('credit_transactions')
    .select('id, user_id, amount')
    .eq('description', unique)

  check('ledger row written', (ledger || []).length === 1, `rows=${(ledger || []).length}`)
  if ((ledger || []).length) {
    check('ledger row belongs to owner', ledger![0].user_id === ownerId)
    check('ledger amount is negative', Number(ledger![0].amount) === -10, String(ledger![0].amount))
  }

  // insufficient-balance path must NOT charge
  const { data: poorOwner } = await db
    .from('profiles')
    .select('id, credits')
    .lte('credits', 5)
    .limit(1)

  if ((poorOwner || []).length) {
    const poorId = poorOwner![0].id
    const balBefore = Number(poorOwner![0].credits ?? 0)
    const { data: poorRes } = await db.rpc('charge_automation', {
      p_user_id: poorId,
      p_amount: 100000,
      p_description: `${unique} (poor)`,
      p_category: 'ai_generation',
    })
    check('charge refuses when balance is short', poorRes?.charged === false, JSON.stringify(poorRes))
    const { data: balAfter } = await db.from('profiles').select('credits').eq('id', poorId).maybeSingle()
    check('refused charge leaves balance untouched', Number(balAfter?.credits ?? 0) === balBefore)
  }

  // zero/negative amounts are rejected outright
  const { data: zeroRes } = await db.rpc('charge_automation', {
    p_user_id: target.id,
    p_amount: 0,
    p_description: `${unique} (zero)`,
    p_category: 'ai_generation',
  })
  check('zero amount is rejected', zeroRes?.charged === false && zeroRes?.reason === 'invalid_request')

  // ---- revert everything this test touched ----
  if ((ledger || []).length) {
    await db.from('credit_transactions').delete().eq('id', ledger![0].id)
    await db.from('profiles').update({ credits: before }).eq('id', ownerId)
  }
  const { data: restored } = await db.from('profiles').select('credits').eq('id', ownerId).maybeSingle()
  check('charge test reverted cleanly', Number(restored?.credits ?? -1) === before, `${restored?.credits} vs ${before}`)
}

/* ====================================================================== */
/* main                                                                   */
/* ====================================================================== */
async function main() {
  testCadence()
  await testBilling()
  testSiteBuilder()

  const env = readEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } })
    await testDatabase(db)
    await testChargeAutomation(db)
  } else {
    console.log('\n(database tests skipped — no service-role credentials found)')
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`passed ${passed}   failed ${failed}`)
  if (failed) {
    console.log('\nfailures:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('ALL AUTOMATION CHECKS PASSED')
}

main().catch((e) => {
  console.error('SUITE CRASHED:', e)
  process.exit(1)
})
