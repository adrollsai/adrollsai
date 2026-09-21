import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
const TARGET_PHONE = '919779278117'
const TEMPLATE_NAME = 'marq'
const HEADER_IMAGE_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/user_assets/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/kie_gen_1789882406376_h3h4kp.png'

async function sendToClientNumber() {
  console.log(`Sending Marq template to ${TARGET_PHONE}...`)

  // 1. Fetch Homcom credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('whatsapp_phone_number_id, whatsapp_access_token, business_name')
    .eq('id', HOMCOM_USER_ID)
    .single()

  const phoneId = profile.whatsapp_phone_number_id
  const accessToken = profile.whatsapp_access_token

  // 2. Ensure lead exists in CRM
  let { data: lead } = await supabase
    .from('leads')
    .select('id, name, phone')
    .eq('user_id', HOMCOM_USER_ID)
    .or(`phone.ilike.%9779278117%`)
    .limit(1)
    .maybeSingle()

  if (!lead) {
    console.log('Creating lead record for 9779278117...')
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        user_id: HOMCOM_USER_ID,
        name: 'Homcom Lead',
        phone: `+${TARGET_PHONE}`,
        pipeline_stage: 'New Lead',
        source: 'WhatsApp Campaign',
        created_at: new Date().toISOString()
      })
      .select()
      .single()
    lead = newLead
  }

  console.log('Lead ID:', lead?.id)

  // 3. Dispatch via Meta API
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`
  const payload = {
    messaging_product: 'whatsapp',
    to: TARGET_PHONE,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: 'en_US' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'image',
              image: { link: HEADER_IMAGE_URL }
            }
          ]
        }
      ]
    }
  }

  const res = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const resData = await res.json()
  console.log('Meta API Response Status:', res.status)
  console.log('Meta API Response Body:', JSON.stringify(resData, null, 2))

  if (res.ok && resData.messages?.[0]?.id) {
    const msgId = resData.messages[0].id
    console.log(`\n🎉 Successfully dispatched message ID: ${msgId}`)

    // 4. Ensure chat in whatsapp_chats
    let { data: chat } = await supabase
      .from('whatsapp_chats')
      .select('id')
      .eq('user_id', HOMCOM_USER_ID)
      .eq('recipient_phone', TARGET_PHONE)
      .maybeSingle()

    if (!chat) {
      const { data: newChat } = await supabase
        .from('whatsapp_chats')
        .insert({
          user_id: HOMCOM_USER_ID,
          recipient_phone: TARGET_PHONE,
          recipient_name: lead?.name || 'Homcom Lead',
          lead_id: lead?.id || null,
          last_message_text: `Sent Template: ${TEMPLATE_NAME}`,
          unread_count: 0,
          updated_at: new Date().toISOString()
        })
        .select()
        .single()
      chat = newChat
    } else {
      await supabase
        .from('whatsapp_chats')
        .update({
          last_message_text: `Sent Template: ${TEMPLATE_NAME}`,
          lead_id: lead?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', chat.id)
    }

    if (chat?.id) {
      await supabase.from('whatsapp_messages').insert({
        chat_id: chat.id,
        direction: 'outbound',
        message_text: `Sent Template: ${TEMPLATE_NAME}`,
        created_at: new Date().toISOString()
      })
    }

    // 5. Track in broadcast recipient
    const broadcastId = '424bf231-dff3-439a-8545-713a077a196f'
    await supabase.from('whatsapp_broadcast_recipients').upsert({
      broadcast_id: broadcastId,
      user_id: HOMCOM_USER_ID,
      lead_id: lead?.id || null,
      phone_number: TARGET_PHONE,
      status: 'sent',
      sent_at: new Date().toISOString()
    })

    console.log('✅ Synchronized chat, lead, and broadcast tracking!')
  } else {
    console.error('Failed to send message:', resData?.error)
  }
}

sendToClientNumber().then(() => process.exit(0)).catch(console.error)
