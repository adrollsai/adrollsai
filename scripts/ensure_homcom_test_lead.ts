import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
const PHONE = '8288835235'

async function checkLead() {
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, phone, pipeline_stage, user_id')
    .eq('user_id', HOMCOM_USER_ID)
    .or(`phone.ilike.%${PHONE}%,phone.eq.${PHONE},phone.eq.91${PHONE},phone.eq.+91${PHONE}`)

  console.log('Existing leads for test phone in HOMCOM:', leads)

  if (!leads || leads.length === 0) {
    console.log('No lead found for test phone. Creating one so flow-runner can update CRM stage and send email...')
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        user_id: HOMCOM_USER_ID,
        name: 'Adrolls Test',
        phone: `+91${PHONE}`,
        pipeline_stage: 'New Lead',
        source: 'WhatsApp Broadcast Test',
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating lead:', error)
    } else {
      console.log('Created test lead:', newLead)
    }
  }
}

checkLead().then(() => process.exit(0)).catch(console.error)
