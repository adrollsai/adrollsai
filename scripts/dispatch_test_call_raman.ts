import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { triggerOutboundCall } from '../utils/voice-helper'

dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function dispatchToUser() {
  const rajUserId = 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f'
  const campaignId = '8e12bad9-7201-43c0-8d08-1d991a28e156'
  const targetPhone = '+918288835235'

  console.log(`[TEST CALL] Looking up lead for ${targetPhone} under Raj Abhijna...`)

  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', rajUserId)
    .ilike('phone', '%8288835235%')
    .maybeSingle()

  if (!lead) {
    console.log('Creating lead for Raman (+918288835235)...')
    const { data: created, error } = await supabaseAdmin
      .from('leads')
      .insert({
        user_id: rajUserId,
        name: 'Raman',
        phone: targetPhone,
        email: 'raman@nobogent.com',
        source: 'Facebook Ads',
        status: 'New Lead',
        voice_campaign_id: campaignId,
        custom_fields: {
          'what_is_your_primary_interest_in_amritha_vana?': 'weekend_farmhouse',
          'preferred_plot_configuration_&_budget?': 'plot_dome_50l',
          'when_would_you_like_to_schedule_a_site_visit?': 'this_weekend',
          meta_ad_origin: {
            campaign_name: 'Amritha Vana Mysore - Luxury Farm Retreats (High Intent HNI)',
            ad_name: 'Ad 1 - Luxury Glamping & Dome Retreat [HNI Detailed]'
          },
          is_instant_form: true,
          qualification_completed: true
        }
      })
      .select()
      .single()
    if (error) throw error
    lead = created
  } else {
    console.log('Updating existing lead for Raman...')
    await supabaseAdmin
      .from('leads')
      .update({
        voice_campaign_id: campaignId,
        voice_call_status: 'scheduled_callback',
        voice_call_scheduled_at: null
      })
      .eq('id', lead.id)
  }

  console.log(`[TEST CALL] Triggering call to ${targetPhone} (Lead ID: ${lead.id})...`)
  const res = await triggerOutboundCall(supabaseAdmin, lead.id, rajUserId, true, campaignId)
  console.log('[TEST CALL] Call dispatch result:', res)
}

dispatchToUser().catch(console.error)
