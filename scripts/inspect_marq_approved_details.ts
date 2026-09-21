import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function inspectMarqDetails() {
  const adminId = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
  const { data: p } = await supabase
    .from('profiles')
    .select('whatsapp_access_token, whatsapp_waba_id, whatsapp_phone_number_id')
    .eq('id', adminId)
    .single()

  const token = p.whatsapp_access_token
  const templateId = '2568758363553630'

  const res = await fetch(`https://graph.facebook.com/v20.0/${templateId}?fields=name,status,language,components,category`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json()
  console.log('Template details for marq (2568758363553630):', JSON.stringify(data, null, 2))
}

inspectMarqDetails().then(() => process.exit(0)).catch(console.error)
