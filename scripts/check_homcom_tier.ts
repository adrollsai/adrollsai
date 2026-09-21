import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'

async function checkTier() {
  const { data: p } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', HOMCOM_USER_ID)
    .single()

  const phoneId = p.whatsapp_phone_number_id
  const token = p.whatsapp_access_token

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=id,display_phone_number,messaging_limit_tier,quality_rating,status`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json()
  console.log('HOMCOM Tier info:', data)
}

checkTier().then(() => process.exit(0)).catch(console.error)
