import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { triggerOutboundCall } from '../utils/voice-helper'

dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  const rajUserId = 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f'
  const campaignId = '8e12bad9-7201-43c0-8d08-1d991a28e156' // Amrithavana Farm Project

  console.log(`[RAJ ABHIJNA CALL DISPATCHER] Fetching leads for user ${rajUserId}...`)

  // Target the leads that never got called due to the qualification bug
  const targetLeadIds = [
    'fb1998c3-b0f8-45f1-8f53-b7c4edc61a17', // Preetham N
    'a6f14d4e-a533-48cb-b8eb-b717873d3681', // Pradeep Kumar
    '529e6ebe-9054-4ea3-b3aa-1748d6bdc416', // Raghu Kashyap
    'd8436c9f-af3a-40e8-9a53-d9dbb50d2197', // Abinav
    '2e38133d-957e-49f5-94f2-18aef8dfe420'  // Niddhi Chugh Chadha
  ]

  const { data: leads, error } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, voice_call_status, custom_fields')
    .in('id', targetLeadIds)

  if (error || !leads) {
    console.error('Failed to fetch leads:', error)
    return
  }

  console.log(`Found ${leads.length} leads to process.`)

  for (const lead of leads) {
    console.log(`\n--------------------------------------------------`)
    console.log(`Dispatching call to ${lead.name} (${lead.phone}) [Lead ID: ${lead.id}]...`)
    
    // Reset lead status from 'qualified_via_whatsapp' so it's clean
    await supabaseAdmin
      .from('leads')
      .update({
        voice_call_status: 'scheduled_callback',
        voice_call_scheduled_at: null,
        voice_campaign_id: campaignId
      })
      .eq('id', lead.id)

    try {
      const result = await triggerOutboundCall(
        supabaseAdmin,
        lead.id,
        rajUserId,
        true,
        campaignId
      )

      console.log(`Result for ${lead.name}:`, result)
    } catch (err: any) {
      console.error(`Error initiating call to ${lead.name}:`, err.message || err)
    }

    // Small delay between dials to avoid spamming Vobiz API
    await new Promise(resolve => setTimeout(resolve, 3000))
  }

  console.log(`\n[RAJ ABHIJNA CALL DISPATCHER] All leads processed!`)
}

main().catch(console.error)
