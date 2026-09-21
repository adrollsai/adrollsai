import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkMarqStatus() {
  const adminId = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
  const { data: p } = await supabase
    .from('profiles')
    .select('whatsapp_access_token, whatsapp_waba_id, whatsapp_phone_number_id')
    .eq('id', adminId)
    .single()

  const wabaId = p.whatsapp_waba_id
  const token = p.whatsapp_access_token

  // Check marq template with full details including reject reason
  const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=marq&fields=name,status,category,rejected_reason,quality_score,components,language`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json()
  
  console.log('=== MARQ TEMPLATE FULL STATUS ===')
  if (data.data && data.data.length > 0) {
    const t = data.data[0]
    console.log('Name:', t.name)
    console.log('Status:', t.status)
    console.log('Category:', t.category)
    console.log('Language:', t.language)
    console.log('Rejected Reason:', t.rejected_reason || 'N/A')
    console.log('Quality Score:', t.quality_score || 'N/A')
    console.log('Full response:', JSON.stringify(t, null, 2))
  } else {
    console.log('No template found! Raw response:', JSON.stringify(data, null, 2))
  }

  // Also check the template ID directly
  const templateId = '2568758363553630'
  const directRes = await fetch(`https://graph.facebook.com/v20.0/${templateId}?fields=name,status,rejected_reason,quality_score`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const directData = await directRes.json()
  console.log('\n=== DIRECT TEMPLATE ID LOOKUP ===')
  console.log(JSON.stringify(directData, null, 2))
}

checkMarqStatus().then(() => process.exit(0)).catch(console.error)
