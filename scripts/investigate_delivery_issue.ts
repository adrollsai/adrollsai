import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function investigateDelivery() {
  console.log('=== 1. CHECK RECENT WEBHOOK STATUS LOGS / FAILURES ===')
  
  // Check if there are any recipient records or logs with status / error
  const { data: recipients } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('*')
    .or('phone_number.ilike.%8288835235%,phone_number.ilike.%918288835235%')
    .order('created_at', { ascending: false })
    .limit(5)
  console.log('Recipient DB records for 8288835235:', recipients)

  // 2. Check HOMCOM WABA phone number health on Meta API
  console.log('\n=== 2. CHECK HOMCOM WABA & PHONE NUMBER HEALTH ===')
  const homcomId = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
  const { data: homcomProf } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', homcomId)
    .single()

  if (homcomProf) {
    const phoneId = homcomProf.whatsapp_phone_number_id
    const token = homcomProf.whatsapp_access_token
    const wabaId = homcomProf.whatsapp_waba_id

    console.log('Phone ID:', phoneId)
    console.log('WABA ID:', wabaId)

    // Check Phone Number status on Graph API
    try {
      const pRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,status,throughput,account_mode`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const pData = await pRes.json()
      console.log('HOMCOM Phone Number Details from Meta:', JSON.stringify(pData, null, 2))
    } catch (e: any) {
      console.error('Phone query error:', e.message)
    }

    // Check WABA status (payment, account review, ban, etc.)
    try {
      const wRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}?fields=name,currency,timezone_id,account_review_status,message_template_namespace,on_behalf_of_business_info`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const wData = await wRes.json()
      console.log('HOMCOM WABA Details from Meta:', JSON.stringify(wData, null, 2))
    } catch (e: any) {
      console.error('WABA query error:', e.message)
    }
  }

  // 3. Find PIPIXEL account and check its status & recent sends
  console.log('\n=== 3. CHECK PIPIXEL ACCOUNT & RECENT SENDS ===')
  const { data: pipixelProfiles } = await supabase
    .from('profiles')
    .select('id, email, business_name, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token')
    .or('business_name.ilike.%pipixel%,email.ilike.%pipixel%')

  console.log('Pipixel profiles found:', pipixelProfiles?.map(p => ({
    id: p.id,
    email: p.email,
    business_name: p.business_name,
    phoneId: p.whatsapp_phone_number_id,
    wabaId: p.whatsapp_waba_id,
    hasToken: !!p.whatsapp_access_token
  })))

  for (const pp of pipixelProfiles || []) {
    if (pp.whatsapp_phone_number_id && pp.whatsapp_access_token) {
      try {
        const pRes = await fetch(`https://graph.facebook.com/v20.0/${pp.whatsapp_phone_number_id}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,status,throughput,account_mode`, {
          headers: { 'Authorization': `Bearer ${pp.whatsapp_access_token}` }
        })
        const pData = await pRes.json()
        console.log(`Pipixel (${pp.business_name || pp.email}) Phone Status:`, JSON.stringify(pData, null, 2))
      } catch (e: any) {
        console.error('Pipixel phone check error:', e.message)
      }

      // Also check WABA
      if (pp.whatsapp_waba_id) {
        try {
          const wRes = await fetch(`https://graph.facebook.com/v20.0/${pp.whatsapp_waba_id}?fields=name,account_review_status`, {
            headers: { 'Authorization': `Bearer ${pp.whatsapp_access_token}` }
          })
          const wData = await wRes.json()
          console.log(`Pipixel WABA Status:`, JSON.stringify(wData, null, 2))
        } catch (e: any) {
          console.error('Pipixel WABA check error:', e.message)
        }
      }
    }

    // Check recent broadcast / messages for Pipixel
    const { data: ppBroadcasts } = await supabase
      .from('whatsapp_broadcasts')
      .select('*')
      .eq('user_id', pp.id)
      .order('created_at', { ascending: false })
      .limit(3)
    console.log(`Recent broadcasts for Pipixel (${pp.id}):`, ppBroadcasts)

    const { data: ppChats } = await supabase
      .from('whatsapp_chats')
      .select('*')
      .eq('user_id', pp.id)
      .order('updated_at', { ascending: false })
      .limit(5)
    console.log(`Recent chats for Pipixel:`, ppChats?.map(c => ({
      phone: c.recipient_phone,
      name: c.recipient_name,
      last_message: c.last_message_text,
      updated_at: c.updated_at
    })))
  }
}

investigateDelivery().then(() => process.exit(0)).catch(console.error)
