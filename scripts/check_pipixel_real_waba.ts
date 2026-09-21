import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkPiPixelWaba() {
  const { data: p } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', 'pawan@pipixel.io')
    .single()

  const phoneId = p.whatsapp_phone_number_id
  const token = p.whatsapp_access_token

  // Find real WABA ID linked to this phone
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=id,display_phone_number,whatsapp_business_account`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json()
  console.log('Phone details with WABA:', JSON.stringify(data, null, 2))

  const realWabaId = data.whatsapp_business_account?.id
  console.log('Real WABA ID:', realWabaId)

  if (realWabaId) {
    const tRes = await fetch(`https://graph.facebook.com/v20.0/${realWabaId}/message_templates`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const tData = await tRes.json()
    console.log('Templates from real WABA ID:', JSON.stringify(tData, null, 2))
  }
}

checkPiPixelWaba().then(() => process.exit(0)).catch(console.error)
