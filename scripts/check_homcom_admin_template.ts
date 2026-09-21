import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkAdminHomcom() {
  const adminId = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
  const { data: p } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', adminId)
    .single()

  console.log('HOMCOM REALTORS Admin Profile:', {
    id: p.id,
    email: p.email,
    business_name: p.business_name,
    phoneId: p.whatsapp_phone_number_id,
    wabaId: p.whatsapp_waba_id,
    hasToken: !!p.whatsapp_access_token
  })

  const wabaId = p.whatsapp_waba_id
  const token = p.whatsapp_access_token

  if (wabaId && token) {
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=marq`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      console.log('Template "marq" from Meta API for WABA', wabaId, ':', JSON.stringify(data, null, 2))
    } catch (e: any) {
      console.error('Fetch error:', e.message)
    }

    // Also fetch all templates list to see approved ones
    try {
      const resAll = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=10`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const dataAll = await resAll.json()
      console.log('Recent templates for HOMCOM:', dataAll.data?.map((t: any) => ({ name: t.name, status: t.status, components: t.components })))
    } catch (e: any) {
      console.error('Fetch all templates error:', e.message)
    }
  }

  // Check existing automations for this admin
  const { data: autos } = await supabase
    .from('automations')
    .select('id, name, is_active, trigger_type, flow_data, description')
    .eq('user_id', adminId)

  console.log('Existing automations for HOMCOM admin:', autos)
}

checkAdminHomcom().then(() => process.exit(0)).catch(console.error)
