import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
const TEST_PHONE = '918288835235'
const TEMPLATE_NAME = 'marq'
const HEADER_IMAGE_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/user_assets/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/kie_gen_1789882406376_h3h4kp.png'

async function sendTestMessage() {
  console.log(`Sending test message to ${TEST_PHONE} using template "${TEMPLATE_NAME}"...`)

  // 1. Fetch Homcom WhatsApp credentials
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, email, business_name, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_waba_id')
    .eq('id', HOMCOM_USER_ID)
    .single()

  if (profErr || !profile) {
    console.error('Failed to load HOMCOM profile:', profErr)
    return
  }

  const phoneId = profile.whatsapp_phone_number_id
  const accessToken = profile.whatsapp_access_token
  if (!phoneId || !accessToken) {
    console.error('HOMCOM profile missing WhatsApp credentials!')
    return
  }

  console.log(`Using HOMCOM phone ID: ${phoneId}`)
  console.log(`Business: ${profile.business_name}`)

  // 2. Fetch or confirm test lead
  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, phone')
    .eq('user_id', HOMCOM_USER_ID)
    .or(`phone.eq.+${TEST_PHONE},phone.eq.${TEST_PHONE},phone.eq.8288835235`)
    .limit(1)
    .maybeSingle()

  const leadId = lead?.id || null
  const leadName = lead?.name || 'Adrolls Test'

  // 3. Send Template Message via Meta API
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`
  
  const payload = {
    messaging_product: 'whatsapp',
    to: TEST_PHONE,
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

  console.log('Sending payload to Meta API:', JSON.stringify(payload, null, 2))

  try {
    const res = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const resData = await res.json()
    console.log('Response status:', res.status)
    console.log('Response body:', JSON.stringify(resData, null, 2))

    if (res.ok && resData.messages?.[0]?.id) {
      const messageId = resData.messages[0].id
      console.log(`\n🎉 Test message successfully sent! Message ID: ${messageId}`)

      // 4. Ensure chat conversation exists and is properly tagged
      let { data: chat } = await supabase
        .from('whatsapp_chats')
        .select('id')
        .eq('user_id', HOMCOM_USER_ID)
        .eq('recipient_phone', TEST_PHONE)
        .maybeSingle()

      if (!chat) {
        const { data: newChat } = await supabase
          .from('whatsapp_chats')
          .insert({
            user_id: HOMCOM_USER_ID,
            recipient_phone: TEST_PHONE,
            recipient_name: leadName,
            lead_id: leadId,
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
            updated_at: new Date().toISOString(),
            lead_id: leadId
          })
          .eq('id', chat.id)
      }

      // 5. Insert outbound message into whatsapp_messages
      if (chat?.id) {
        await supabase.from('whatsapp_messages').insert({
          chat_id: chat.id,
          direction: 'outbound',
          message_text: `Sent Template: ${TEMPLATE_NAME}`,
          created_at: new Date().toISOString()
        })
      }

      // 6. Also create a broadcast recipient record for consistency
      const { data: bcast } = await supabase
        .from('whatsapp_broadcasts')
        .select('id')
        .eq('user_id', HOMCOM_USER_ID)
        .eq('template_name', TEMPLATE_NAME)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let broadcastId = bcast?.id
      if (!broadcastId) {
        const { data: newBcast } = await supabase
          .from('whatsapp_broadcasts')
          .insert({
            user_id: HOMCOM_USER_ID,
            title: `[Flow: The Marq — Sector 82] Test Send [flow:3a9feb3e-3126-47b6-a516-57201aee78cf]`,
            template_name: TEMPLATE_NAME,
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .select()
          .single()
        broadcastId = newBcast?.id
      }

      if (broadcastId) {
        await supabase
          .from('whatsapp_broadcast_recipients')
          .upsert({
            broadcast_id: broadcastId,
            user_id: HOMCOM_USER_ID,
            lead_id: leadId,
            phone_number: TEST_PHONE,
            status: 'sent',
            sent_at: new Date().toISOString()
          })
      }

      console.log('✅ Flow tracking & database state synchronized!')
      console.log('Now, when you tap "View Payment Plan" on WhatsApp:')
      console.log('1. Flow Runner will intercept the webhook.')
      console.log('2. It will reply with the complete Payment Plan text.')
      console.log('3. It will update your lead status to "Interested".')
      console.log('4. It will send an email alert to ihomcomrealtors@gmail.com.')
    } else {
      console.error('\n❌ Message failed to send!')
      console.error(resData?.error)
    }
  } catch (err: any) {
    console.error('Fetch exception:', err)
  }
}

sendTestMessage().then(() => process.exit(0)).catch(console.error)
