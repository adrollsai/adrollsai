import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function inspectPipixelSend() {
  const { data: p } = await supabase
    .from('profiles')
    .select('id, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_waba_id')
    .eq('email', 'pawan@pipixel.io')
    .single()

  console.log('Pipixel profile:', p)

  if (p && p.whatsapp_phone_number_id && p.whatsapp_access_token) {
    // Check templates for Pipixel
    const tRes = await fetch(`https://graph.facebook.com/v20.0/${p.whatsapp_waba_id}/message_templates?limit=10`, {
      headers: { 'Authorization': `Bearer ${p.whatsapp_access_token}` }
    })
    const tData = await tRes.json()
    console.log('Pipixel templates:', tData)

    // Check recent message status via phone number ID
    // Let's also check if test2 template is APPROVED and what category it is (MARKETING vs UTILITY)
  }
}

inspectPipixelSend().then(() => process.exit(0)).catch(console.error)
