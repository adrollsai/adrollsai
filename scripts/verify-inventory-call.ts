/**
 * ONE verification call to the operator, on the LIVE production campaign.
 *
 * Tests three fixes at once:
 *   1. the "Hi" is crisp, not stretched
 *   2. search_properties actually fires and returns the Mohali/Zirakpur inventory
 *   3. it refuses Gurgaon instead of inventing it
 *
 * ANSWER IT AND ASK: "Aapke paas Gurgaon mein kya project hai?"
 * Then: "Aapke paas Mohali mein kya hai?"
 *
 * RUN  node .tmp-verify.cjs
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const PROFILE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'
const CAMPAIGN_ID = '0e4a36d9-50ad-4718-b51f-a38fde6dc082' // live campaign with all the fixes
const FROM = '+917965480905'
const AUTH_ID = 'SA_RUY0ZNCH'
const AUTH_TOKEN = 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi'
const TO = '+918288835235'

async function main() {
  const { data: lead, error } = await db.from('leads').insert({
    user_id: PROFILE_ID,
    name: 'Adrolls',
    phone: TO,
    source: 'AI Call Demo',
    pipeline_stage: 'New Lead',
    status: 'New Lead',
    voice_campaign_id: CAMPAIGN_ID,
    voice_call_status: 'pending_qualification',
    notes: '[VERIFICATION CALL] Testing crisp greeting + search_properties inventory lookup + Gurgaon refusal. Not a real lead.',
    custom_fields: {
      is_demo_call: true,
      is_test_call: true,
      skip_credit_deduction: true,
      allow_after_hours: true,
      verify_inventory_tool: true,
      triggered_at: new Date().toISOString(),
    },
  }).select().single()

  if (error || !lead) { console.error('lead insert failed:', error?.message); process.exit(1) }
  console.log('lead created:', lead.id)

  const { triggerVobizOutboundCall } = await import('@/utils/vobiz-helper')
  const res = await triggerVobizOutboundCall(db, {
    leadId: lead.id,
    profileId: PROFILE_ID,
    toPhone: TO,
    fromPhone: FROM,
    campaignId: CAMPAIGN_ID,
    voiceName: 'Aoede',
    allowAfterHours: true,
    skipCreditCheck: true,
    customAuthId: AUTH_ID,
    customAuthToken: AUTH_TOKEN,
  })

  console.log(res.success || res.scheduled ? `dialling -> ${res.callUuid}` : `FAILED: ${res.error}`)
  console.log('\nAnswer and ask: "Aapke paas Gurgaon mein kya project hai?" then "Mohali mein kya hai?"')
  console.log(`Lead id for readback: ${lead.id}`)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
