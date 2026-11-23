/**
 * Bluesquare test calls - using the APP'S OWN DEFAULT SCRIPT.
 *
 * WHY THERE IS NO custom_prompt HERE
 * The default caller you liked is the bridge's built-in system instruction
 * (voice-bridge/server.js buildGeminiSetupConfig). It already:
 *   - reads the lead's form answers, CRM notes, product + catalogue context
 *   - asks a single discovery question and stops talking
 *   - defaults to Hinglish and switches language with the caller
 *   - books a slot via the book_appointment_slot tool
 *
 * A non-empty custom_prompt is appended as "CAMPAIGN SPECIFIC GUIDELINES" and
 * overrides all of that - which is exactly what a hand-written script did wrong.
 * So custom_prompt is deliberately NULL: the route's contextual script and the
 * bridge's default caller are left untouched.
 *
 * WHAT WE DO SET (all per-campaign, nothing account-wide):
 *   audience_filter.voice_name = 'Aoede'          -> female voice
 *   audience_filter.language   = 'hinglish'       -> Hinglish default
 *   audience_filter.greeting   = 'Hi {name} ji, kaise ho aap?'
 *   audience_filter.qualifying_questions          -> the 3 structured questions
 *
 * The bridge substitutes {name} in the greeting for every path (server.js:1870),
 * rejects a Hindi greeting only when the campaign prompt is English (we have no
 * prompt, so it is accepted), and uses the questions list to build the
 * qualification criteria and map answers back into custom_fields.
 *
 * ENGINE: Gemini Live only. No answerPath -> default /api/voice/vobiz/xml ->
 * {bridge}/gemini-live-stream. No TTS model anywhere.
 *
 * RUN
 *   npx esbuild scripts/test-bluesquare-scripts.ts --bundle --platform=node \
 *     --format=cjs --packages=external --alias:@=./ --outfile=.tmp-bs-test.cjs
 *   node .tmp-bs-test.cjs --dry-run     # inspect, dial nothing
 *   node .tmp-bs-test.cjs               # place 3 calls, 45s apart
 *   node .tmp-bs-test.cjs --calls=1     # just one
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

/** Blue Square Infra */
const PROFILE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'
const FROM_NUMBER = '+917965480905'
const VOBIZ_AUTH_ID = 'SA_RUY0ZNCH'
const VOBIZ_AUTH_TOKEN = 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi'

/** Test target - the operator's own number. Never a real lead. */
const TEST_NUMBER = '+918288835235'
const TEST_NAME = 'Adrolls'

/** Female voice. */
const VOICE = 'Aoede'

/** Exact opening line requested. {name} is substituted by the bridge. */
const GREETING = 'Hi {name} ji, kaise ho aap?'

/**
 * Structured qualifying questions. These are what the default script asks, in
 * this order, and what lands in custom_fields so the lead can be scored.
 */
const QUALIFYING_QUESTIONS = [
  { question: 'What is your budget range?', options: ['40L - 60L', '60L - 80L', '80L - 1Cr', 'Above 1Cr'] },
  { question: 'What is your purchase timeline?', options: ['Immediate', 'This Month', 'Within 3 Months', 'Exploring'] },
  { question: 'What are you looking for?', options: ['Plot', 'Flat', 'Commercial', 'Investment'] },
]

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const callCount = Number(process.argv.find((a) => a.startsWith('--calls='))?.split('=')[1] || 3)

  const payload = {
    user_id: PROFILE_ID,
    name: '[TEST] Blue Square Infra - APP DEFAULT SCRIPT (Aoede, Hinglish)',
    audience_filter: {
      language: 'hinglish',
      voice_name: VOICE,
      greeting: GREETING,
      qualifying_questions: QUALIFYING_QUESTIONS,
      is_demo: true,
      is_test: true,
    },
    // Deliberately NULL: keep the app's own default script.
    custom_prompt: null as null,
    status: 'draft',
  }

  console.log(`\n=== ${dryRun ? 'DRY RUN - nothing will be dialled' : 'LIVE TEST CALLS'} ===`)
  console.log(`target ${TEST_NUMBER} (${TEST_NAME})  |  from ${FROM_NUMBER}`)
  console.log(`engine gemini-live  |  voice ${VOICE} (female)  |  language hinglish`)
  console.log(`script: APP DEFAULT (custom_prompt = null)`)
  console.log(`greeting: "${GREETING.replace('{name}', TEST_NAME)}"`)
  console.log(`questions: ${QUALIFYING_QUESTIONS.map((q) => q.question).join(' | ')}\n`)

  if (dryRun) {
    console.log('[dry] would create campaign with:')
    console.log(JSON.stringify(payload.audience_filter, null, 2))
    console.log(`[dry] would place ${callCount} call(s), 45s apart\n`)
    return
  }

  const { data: camp, error: campErr } = await db.from('voice_campaigns').insert(payload).select().single()
  if (campErr || !camp) {
    console.error(`  x campaign insert failed: ${campErr?.message}`)
    process.exit(1)
  }
  console.log(`campaign ${camp.id}\n`)

  const { triggerVobizOutboundCall } = await import('@/utils/vobiz-helper')

  for (let i = 1; i <= callCount; i++) {
    const { data: lead, error: leadErr } = await db.from('leads').insert({
      user_id: PROFILE_ID,
      name: TEST_NAME,
      phone: TEST_NUMBER,
      source: 'AI Call Demo',
      pipeline_stage: 'New Lead',
      status: 'New Lead',
      voice_campaign_id: camp.id,
      voice_call_status: 'pending_qualification',
      notes: `[TEST CALL ${i}/${callCount}] App default script, Aoede female, Hinglish. Checking context awareness + question flow + booking. Not a real lead.`,
      custom_fields: {
        is_demo_call: true,
        is_test_call: true,
        skip_credit_deduction: true,
        allow_after_hours: true,
        test_run: i,
        triggered_at: new Date().toISOString(),
      },
    }).select().single()

    if (leadErr || !lead) {
      console.error(`  x lead insert failed: ${leadErr?.message}`)
      continue
    }

    const res = await triggerVobizOutboundCall(db, {
      leadId: lead.id,
      profileId: PROFILE_ID,
      toPhone: TEST_NUMBER,
      fromPhone: FROM_NUMBER,
      campaignId: camp.id,
      voiceName: VOICE,
      allowAfterHours: true, // bypass the 09:00-19:00 IST gate
      skipCreditCheck: true,
      customAuthId: VOBIZ_AUTH_ID,
      customAuthToken: VOBIZ_AUTH_TOKEN,
    })

    console.log(`  ${res.success || res.scheduled ? 'ok' : 'x '} call ${i}/${callCount}  lead=${lead.id}  vobiz=${res.callUuid ?? '-'}  ${res.error ?? ''}`)

    if (i < callCount) await new Promise((r) => setTimeout(r, 45_000))
  }

  console.log(`\nDone. Set your phone aside after the last call, then read back:
  SELECT name, voice_call_status, voice_call_summary,
         custom_fields->>'is_qualified'  AS is_qualified,
         custom_fields->>'budget'        AS budget,
         custom_fields->>'timeline'      AS timeline,
         voice_recording_url
  FROM leads
  WHERE voice_campaign_id = '${camp.id}'
  ORDER BY created_at;
`)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
