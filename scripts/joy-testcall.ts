/**
 * TEST CALL: dials the operator (+91 8288835235) as if their lead came from a
 * Joy Grand campaign, so the exact production behaviour can be heard before a
 * single real Joy lead is dialled.
 *
 * Mirrors a real Joy Grand lead:
 *   ad_name / form_name / meta_ad_origin -> "Joy Grand ..."
 *   meta_ad_origin.product_id            -> the catalogued property behind Joy Grand
 *   property_id                          -> so the catalogue block resolves
 *   csv_audience + audience_groups       -> "Joy Grand Campaigns"
 *
 * RUN  node .tmp-joy-testcall.mjs
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const PROFILE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'
const CAMPAIGN_ID = '0e4a36d9-50ad-4718-b51f-a38fde6dc082' // live campaign, all fixes
const FROM = '+917965480905'
const AUTH_ID = 'SA_RUY0ZNCH'
const AUTH_TOKEN = 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi'
const TO = '+918288835235'
const JOY_PROPERTY = '8fd467e2-a7d9-42a8-9bb3-b86f8506b572'
const GROUP = 'Joy Grand Campaigns'

async function main() {
  const { data: lead, error } = await db.from('leads').insert({
    user_id: PROFILE_ID,
    name: 'Adrolls',
    phone: TO,
    source: 'Facebook Ads',
    pipeline_stage: 'New Lead',
    status: 'New Lead',
    ad_name: 'Joy Grand | 05-AUG- Rs.2.40 cr',
    form_name: 'Joy Grand',
    property_id: JOY_PROPERTY,
    voice_campaign_id: CAMPAIGN_ID,
    voice_call_status: 'pending_qualification',
    csv_audience: GROUP,
    notes: '[TEST CALL - Joy Grand audience] Simulated Joy Grand lead to hear the live script. Not a real lead.',
    custom_fields: {
      is_demo_call: true,
      is_test_call: true,
      skip_credit_deduction: true,
      allow_after_hours: true,
      audience_groups: [GROUP],
      meta_ad_origin: {
        ad_name: 'Joy Grand | 05-AUG- Rs.2.40 cr',
        campaign_name: 'Joy Grand | 05-AUG- Rs.2.40 cr',
        headline: 'Joy Grand',
        product_name: 'Joy Grand',
        product_id: JOY_PROPERTY,
      },
      triggered_at: new Date().toISOString(),
    },
  }).select().single()

  if (error || !lead) { console.error('lead insert failed:', error?.message); process.exit(1) }
  console.log('test lead created:', lead.id)

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

  console.log(res.success || res.scheduled ? `DIALLING -> ${res.callUuid}` : `FAILED: ${res.error}`)
  console.log('\nAnswer and try: "Joy Grand ke baare mein batao" / "Gurgaon mein kya hai?" / "budget 80 lakh hai"')
  console.log('readback lead id:', lead.id)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
