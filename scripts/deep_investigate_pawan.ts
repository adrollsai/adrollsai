import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PIPIXEL_USER_ID = 'c7bede84-d7ea-4b02-bbbb-017d24a37914'

async function deepInvestigatePawan() {
  console.log('=== 1. PAWAN IN PIPIXEL LEADS CRM ===')
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('user_id', PIPIXEL_USER_ID)
    .or('name.ilike.%pawan%,phone.ilike.%8528938292%')

  console.log('Pawan Leads in PiPixel CRM:', leads)

  console.log('\n=== 2. ALL RECENT CHATS FOR PIPIXEL ===')
  const { data: chats } = await supabase
    .from('whatsapp_chats')
    .select('*, whatsapp_messages(*)')
    .eq('user_id', PIPIXEL_USER_ID)
    .order('updated_at', { ascending: false })
    .limit(5)

  console.log('Recent PiPixel chats:', JSON.stringify(chats, null, 2))

  console.log('\n=== 3. CHECK PIPIXEL PROFILE CREDENTIALS & PHONE NUMBER ===')
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', PIPIXEL_USER_ID)
    .single()

  console.log('PiPixel profile info:', {
    id: profile.id,
    email: profile.email,
    business_name: profile.business_name,
    phone_id: profile.whatsapp_phone_number_id,
    waba_id: profile.whatsapp_waba_id,
    business_account_id: profile.whatsapp_business_account_id
  })

  // Check phone number on Meta API
  const token = profile.whatsapp_access_token
  const phoneId = profile.whatsapp_phone_number_id

  if (phoneId && token) {
    const pRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,status,throughput,account_mode,name_status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const pData = await pRes.json()
    console.log('PiPixel Phone details on Meta:', JSON.stringify(pData, null, 2))
  }

  // Check templates from Meta for PiPixel's WABA
  const wabaId = profile.whatsapp_waba_id || profile.whatsapp_business_account_id
  console.log('\n=== 4. CHECK TEMPLATES FOR WABA', wabaId, '===')
  if (wabaId && token) {
    // Try both /v20.0/{wabaId}/message_templates and /v20.0/{phoneId}/message_templates
    const tRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?fields=name,status,category,language,components`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const tData = await tRes.json()
    console.log('PiPixel Templates from WABA:', JSON.stringify(tData, null, 2))
  }
}

deepInvestigatePawan().then(() => process.exit(0)).catch(console.error)
