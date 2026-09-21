import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function inspectHomcom() {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, business_name, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_waba_id, whatsapp_business_account_id')
    .or('business_name.ilike.%homcom%,email.ilike.%homcom%')

  console.log('Homcom Profiles found:', profiles)

  if (profiles && profiles.length > 0) {
    const p = profiles[0]
    console.log(`Using Homcom profile: ${p.id} (${p.email} / ${p.business_name})`)
    
    // Check automations for Homcom
    const { data: automations } = await supabase
      .from('automations')
      .select('id, name, trigger_type, is_active, flow_data, description')
      .eq('user_id', p.id)

    console.log('Existing Automations for Homcom:', automations)

    // Check Meta templates for Homcom if token is present
    if (p.whatsapp_access_token && (p.whatsapp_waba_id || p.whatsapp_business_account_id)) {
      const wabaId = p.whatsapp_waba_id || p.whatsapp_business_account_id
      const metaUrl = `https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=marq`
      try {
        const res = await fetch(metaUrl, {
          headers: { 'Authorization': `Bearer ${p.whatsapp_access_token}` }
        })
        const resData = await res.json()
        console.log('Meta template query result for "marq":', JSON.stringify(resData, null, 2))
      } catch (e: any) {
        console.error('Error fetching template from Meta:', e.message)
      }
    }
  }
}

inspectHomcom().then(() => process.exit(0)).catch(console.error)
