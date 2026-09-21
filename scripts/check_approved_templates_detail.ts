import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkTemplates() {
  const adminId = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
  const { data: p } = await supabase
    .from('profiles')
    .select('whatsapp_access_token, whatsapp_waba_id, whatsapp_phone_number_id')
    .eq('id', adminId)
    .single()

  const wabaId = p.whatsapp_waba_id
  const token = p.whatsapp_access_token

  // Fetch ALL templates with full details
  const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=50`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json()
  
  console.log('=== ALL TEMPLATES (FULL DETAIL) ===')
  for (const t of data.data || []) {
    console.log(`\n--- ${t.name} (${t.status}) ---`)
    console.log(JSON.stringify(t.components, null, 2))
  }

  // Also check if marq template is approved now
  const marqRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=marq`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const marqData = await marqRes.json()
  console.log('\n=== MARQ STATUS ===')
  console.log('Status:', marqData.data?.[0]?.status)
}

checkTemplates().then(() => process.exit(0)).catch(console.error)
