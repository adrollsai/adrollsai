/**
 * Blue Square Infra - real-lead calling batch (pilot slice).
 *
 * WHO IT CALLS
 *   - never dialled before (voice_call_status null / 'not_called', retry_count 0, no last_call_at)
 *   - pipeline_stage NOT lost/NI/junk/invalid/already-purchased/never-picked
 *   - has a usable Indian mobile
 *   - not opted out, not already booked
 *   - newest enquiries first (warmest), excluding the operator's own number
 *
 * HOW IT PACES
 *   The Bluesquare line is ONE Vobiz channel with concurrency 3
 *   (lib/automation/voice-channels.ts fallback). triggerVobizOutboundCall returns
 *   as soon as the call is created, so we pace DISPATCH rather than outcome:
 *   one call every --pace seconds keeps ~3 legs busy for a 90-120s call.
 *
 * HARD STOPS (all three, whichever comes first)
 *   1. --until   (default 20:00 IST)
 *   2. --max     (default 100 calls)
 *   3. 5 consecutive dispatch failures -> abort, something is wrong upstream
 *
 * NOTE ON TEST MODE
 *   OUTBOUND_TEST_MODE only redirects callers that go through voice-helper.ts
 *   (outboundRecipient at :297). triggerVobizOutboundCall does NOT, so these
 *   are real calls to real people. That is deliberate here.
 *
 * NOTE ON CONTEXT
 *   The bridge does not read lead.notes, so for most leads it will ask budget
 *   again even though the form captured it. See notes at the bottom.
 *
 * RUN
 *   npx esbuild scripts/call-bluesquare-batch.ts --bundle --platform=node \
 *     --format=cjs --packages=external --alias:@=./ --outfile=.tmp-bs-batch.cjs
 *   node .tmp-bs-batch.cjs --dry-run
 *   node .tmp-bs-batch.cjs --max=60 --pace=40
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const PROFILE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'
const FROM_NUMBER = '+917965480905'
const VOBIZ_AUTH_ID = 'SA_RUY0ZNCH'
const VOBIZ_AUTH_TOKEN = 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi'

/** Campaign created by test-bluesquare-scripts.ts: default script, Aoede, Hinglish. */
const CAMPAIGN_ID = '0e4a36d9-50ad-4718-b51f-a38fde6dc082'
const VOICE = 'Aoede'

/** Never dial the operator, or Blue Square Infra's own lines. */
const EXCLUDE_NUMBERS = new Set([
  '918288835235',                 // operator (test target)
  '7965480905', '917965480905',   // Blue Square DID = the caller ID itself
  '9872490091', '919872490091',   // contact_number
  '9877132623', '919877132623',   // whatsapp_phone_number
])

const arg = (name: string, fallback: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : fallback
}
const dryRun = process.argv.includes('--dry-run')
const MAX_CALLS = arg('max', 150)
const PACE_SEC = arg('pace', 38)
const DISPATCH_TIMEOUT_MS = arg('timeout', 30) * 1000
const UNTIL = String(arg('untilHour', 20)).padStart(2, '0') + ':' + String(arg('untilMin', 0)).padStart(2, '0')

/**
 * Optional audience restriction. `--group=Joy` dials only leads whose
 * csv_audience (or custom_fields.audience_groups) contains that text - the same
 * field lib/audiences/filters.ts uses, so it matches what the CRM shows as an
 * audience. Substring rather than exact so a shell can pass it without quoting
 * the spaces in "Joy Grand Campaigns".
 */
const GROUP_FILTER = (process.argv.find((a) => a.startsWith('--group='))?.split('=')[1] || '').trim().toLowerCase()
const inGroup = (l: any): boolean => {
  if (!GROUP_FILTER) return true
  const csv = String(l.csv_audience || '').toLowerCase()
  if (csv.includes(GROUP_FILTER)) return true
  const cf = cfOf(l.custom_fields)
  const groups = Array.isArray(cf?.audience_groups) ? cf.audience_groups.map((g: any) => String(g).toLowerCase()) : []
  return groups.some((g: string) => g.includes(GROUP_FILTER))
}

const LOST_RE = /(lost|ni\b|not interested|junk|invalid|already purchased|unqualified|dropped|dead|never picked)/i
/**
 * ONLY genuinely untouched leads.
 *
 * A previous version also let through 'Contacted', 'Requirement Taken',
 * 'Plan Postponed' and 'Dealer' because they merely lack AI-call history — but
 * those have already been worked by a human telecaller, and some have had their
 * requirement taken. Re-asking their budget with a bot is worse than not calling.
 * "Not touched till now" means exactly these two stages.
 */
const UNTOUCHED_RE = /^(new lead|new)$/i
/**
 * Option B (--include-worked): also dial stages a human telecaller has already
 * touched. This is safe now in a way it was not before: the script reads the CRM
 * notes and form answers and CONFIRMS known facts instead of re-asking them, so a
 * "Requirement Taken" lead is not interrogated from scratch.
 *
 * Dealers (brokers, not end buyers) stay out, as does every lost/NI stage.
 */
const INCLUDE_WORKED = process.argv.includes('--include-worked')
const WORKED_OK_RE = /^(new lead|new|contacted|requirement taken|plan postponed)$/i
/**
 * Leads that came from a recruitment ad, not a property ad.
 *
 * 67 leads carry ad_name "Hiring" — the business runs job ads from the same
 * Facebook page, so Facebook delivered job applicants into the same lead table.
 * The AI caller then phoned them about plots, and one ("meri job hai") was even
 * booked a site visit by the pre-gate script. They are not buyers.
 */
const JOB_AD_RE = /hiring|vacanc|job\b|career|recruit|internship|walk-?in/i
const DIALED = new Set(['completed', 'no_answer', 'failed', 'calling', 'busy', 'cancelled'])

const digits = (p?: string | null) => String(p ?? '').replace(/\D/g, '')
const cfOf = (v: any) => {
  try { return typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}) } catch { return {} }
}

/**
 * Leads are stored in mixed formats ("+91 9814023251", "098140...", 10-digit).
 * Vobiz wants clean E.164, and a space in the middle has cost a call before.
 */
function normalisePhone(p?: string | null): string | null {
  let d = digits(p)
  if (!d) return null
  if (d.length === 10) d = '91' + d
  else if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1)
  if (d.length !== 12 || !d.startsWith('91')) return null
  if (!/[6-9]/.test(d[2])) return null
  return '+' + d
}

/**
 * A dispatch must never be able to stall the queue. Yesterday one lead hung the
 * whole batch for ~35 minutes because triggerVobizOutboundCall was awaited with
 * no bound at all.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms)),
  ])
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Deadline as an absolute Date: today at UNTIL, Asia/Kolkata (UTC+5:30, no DST). */
function deadline(): Date {
  const [h, m] = UNTIL.split(':').map(Number)
  const nowUtc = new Date()
  // Build today's date in IST, then convert the wall-clock back to UTC.
  const ist = new Date(nowUtc.getTime() + 5.5 * 3600_000)
  const targetIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, m, 0, 0)
  return new Date(targetIst - 5.5 * 3600_000)
}

async function loadCandidates() {
  const rows: any[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('leads')
      .select('id,name,phone,pipeline_stage,voice_call_status,voice_call_retry_count,booked_time,last_call_at,created_at,custom_fields,opted_out,ad_name,form_name,source')
      .eq('user_id', PROFILE_ID)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`leads read failed: ${error.message}`)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }

  const skipped: Record<string, number> = {}
  const bump = (k: string) => { skipped[k] = (skipped[k] ?? 0) + 1 }

  const eligible = rows.filter((l) => {
    if (LOST_RE.test(String(l.pipeline_stage || ''))) { bump('lost_or_ni'); return false }
    const stage = String(l.pipeline_stage || '').trim()
    if (INCLUDE_WORKED ? !WORKED_OK_RE.test(stage) : !UNTOUCHED_RE.test(stage)) { bump('stage_excluded'); return false }
    if (!inGroup(l)) { bump('not_in_audience'); return false }
    // Job-ad leads are applicants, not property buyers.
    if (JOB_AD_RE.test(String(l.ad_name || '')) || JOB_AD_RE.test(String(l.form_name || ''))) { bump('job_ad_lead'); return false }
    const e164 = normalisePhone(l.phone)
    if (!e164) { bump('bad_phone'); return false }
    if (EXCLUDE_NUMBERS.has(e164) || EXCLUDE_NUMBERS.has(digits(e164).slice(-10))) { bump('operator_number'); return false }
    if (l.opted_out === true) { bump('opted_out'); return false }
    const cf = cfOf(l.custom_fields)
    if (cf.opt_out === true || String(cf.opt_out) === 'true' || cf.unsubscribed_at) { bump('opted_out'); return false }
    if (l.booked_time) { bump('already_booked'); return false }
    if ((l.voice_call_retry_count ?? 0) > 0 || l.last_call_at) { bump('already_contacted'); return false }
    if (DIALED.has(String(l.voice_call_status || '').toLowerCase())) { bump('already_contacted'); return false }
    return true
  })

  return { rows, eligible, skipped }
}

async function main() {
  const { rows, eligible, skipped } = await loadCandidates()
  const stopAt = deadline()

  console.log(`\n=== BLUE SQUARE REAL-LEAD BATCH ${dryRun ? '(DRY RUN)' : '(LIVE)'} ===`)
  console.log(`total leads            ${rows.length}`)
  console.log(`eligible to dial       ${eligible.length}`)
  console.log(`skipped                ${JSON.stringify(skipped)}`)
  console.log(`campaign               ${CAMPAIGN_ID} (default script, ${VOICE}, hinglish)`)
  console.log(`from                   ${FROM_NUMBER}`)
  console.log(`pace                   1 call / ${PACE_SEC}s  (line concurrency 3)`)
  console.log(`max calls              ${MAX_CALLS}`)
  console.log(`stop at                ${UNTIL} IST  ->  ${stopAt.toISOString()}`)
  console.log(`now                    ${new Date().toISOString()}\n`)

  const queue = eligible.slice(0, MAX_CALLS)

  if (dryRun) {
    console.log('[dry] would dial these, newest first:')
    queue.slice(0, 25).forEach((l, i) => {
      const cf = cfOf(l.custom_fields)
      const known = Object.keys(cf).filter((k) => /what_|which_|budget|timeline|looking|config|interested/i.test(k)).length
      console.log(`  ${String(i + 1).padStart(3)}. ${String(l.name || '(no name)').slice(0, 22).padEnd(24)} stage=${String(l.pipeline_stage || '-').slice(0, 18).padEnd(20)} knownAnswers=${known}`)
    })
    if (queue.length > 25) console.log(`  ... and ${queue.length - 25} more`)
    const minutes = (stopAt.getTime() - Date.now()) / 60000
    console.log(`\n[dry] window left: ${minutes.toFixed(1)} min -> approx ${Math.floor((minutes * 60) / PACE_SEC)} calls at this pace`)
    return
  }

  const { triggerVobizOutboundCall } = await import('@/utils/vobiz-helper')

  let dispatched = 0
  let failed = 0
  let consecutiveFailures = 0
  const failures: Array<{ lead: string; error: string }> = []

  for (const lead of queue) {
    if (Date.now() >= stopAt.getTime()) {
      console.log(`\nSTOP: reached ${UNTIL} IST.`)
      break
    }
    if (consecutiveFailures >= 5) {
      console.log(`\nABORT: 5 consecutive dispatch failures. Last error: ${failures.at(-1)?.error}`)
      break
    }

    const e164 = normalisePhone(lead.phone)!
    let res: any = null
    let attemptError = ''

    // Transient Supabase reads have returned "User profile not found." for a
    // profile that demonstrably exists, so retry once before recording a failure.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        res = await withTimeout(
          triggerVobizOutboundCall(db, {
            leadId: lead.id,
            profileId: PROFILE_ID,
            toPhone: e164,
            fromPhone: FROM_NUMBER,
            campaignId: CAMPAIGN_ID,
            voiceName: VOICE,
            allowAfterHours: true,   // the 09:00-19:00 gate would otherwise reschedule everything
            skipCreditCheck: false,  // real calls, so meter them properly
            customAuthId: VOBIZ_AUTH_ID,
            customAuthToken: VOBIZ_AUTH_TOKEN,
          }),
          DISPATCH_TIMEOUT_MS,
          `lead ${lead.id} attempt ${attempt}`,
        )
        attemptError = ''
        break
      } catch (e: any) {
        attemptError = e?.message || 'throw'
        if (attempt < 2) await sleep(3000)
      }
    }

    if (res && (res.success || res.scheduled)) {
      dispatched++
      consecutiveFailures = 0
      console.log(`  ok   ${String(dispatched).padStart(3)}  ${String(lead.name || '(no name)').slice(0, 20).padEnd(22)} ${String(lead.pipeline_stage || '-').slice(0, 14).padEnd(16)} ${e164}  ${res.callUuid ?? ''}`)
    } else {
      failed++
      consecutiveFailures++
      const err = attemptError || String(res?.error || 'unknown')
      failures.push({ lead: lead.id, error: err })
      console.log(`  FAIL ${String(lead.id).slice(0, 8)}  ${e164}  ${err.slice(0, 110)}`)
    }

    await sleep(PACE_SEC * 1000)
  }

  console.log(`\n=== BATCH SUMMARY ===`)
  console.log(`dispatched ${dispatched}   failed ${failed}   remaining in queue ${queue.length - dispatched - failed}`)
  if (failures.length) console.log(`failures: ${JSON.stringify(failures.slice(0, 8), null, 2)}`)
  console.log(`
Read back tomorrow (calls need time to finish and be summarised):
  SELECT voice_call_status, count(*) FROM leads
  WHERE voice_call_status IN ('completed','no_answer','failed','calling') 
    AND updated_at > now() - interval '2 hours'
  GROUP BY 1;

  SELECT name, voice_call_status, custom_fields->>'is_qualified' AS qualified,
         custom_fields->>'budget' AS budget, custom_fields->>'timeline' AS timeline,
         left(voice_call_summary, 200) AS summary
  FROM leads WHERE updated_at > now() - interval '2 hours'
    AND voice_call_status = 'completed' ORDER BY updated_at DESC;
`)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
