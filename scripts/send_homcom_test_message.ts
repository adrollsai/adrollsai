import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
const TEST_PHONE = '918288835235' // Your number with 91 prefix
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

  // 2. Send Template Message via Meta API
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

  console.log('Payload:', JSON.stringify(payload, null, 2))

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
      console.log(`\n✅ Test message sent successfully!`)
      console.log(`Message ID: ${resData.messages[0].id}`)
      console.log(`Sent to: ${TEST_PHONE}`)
      
      // Ensure chat record exists so replies show up in inbox
      const { data: existingChat } = await supabase
        .from('whatsapp_chats')
        .select('id')
        .eq('user_id', HOMCOM_USER_ID)
        .eq('recipient_phone', TEST_PHONE)
        .maybeSingle()

      if (!existingChat) {
        await supabase.from('whatsapp_chats').insert({
          user_id: HOMCOM_USER_ID,
          recipient_phone: TEST_PHONE,
          recipient_name: 'Test User',
          last_message_text: `Sent Template: ${TEMPLATE_NAME}`,
          unread_count: 0,
          updated_at: new Date().toISOString()
        })
        console.log('📋 Created chat record for test number in inbox')
      }
    } else {
      console.error(`\n❌ Message failed to send!`)
      console.error('Error:', resData?.error?.message || 'Unknown error')
      console.error('Error code:', resData?.error?.code)
      console.error('Full error:', JSON.stringify(resData?.error, null, 2))
      
      if (resData?.error?.message?.includes('pending') || resData?.error?.code === 100) {
        console.log('\n⚠️  Template "marq" is still PENDING approval from Meta.')
        console.log('You need to wait for Meta to approve the template before sending.')
        console.log('Usually takes a few minutes to 24 hours.')
        console.log('\n💡 Alternative: We can test with an already-approved template like "real_estate_tailored_inventory"')
      }
    }
  } catch (sendErr: any) {
    console.error('Fetch exception:', sendErr.message)
  }
}

sendTestMessage().then(() => process.exit(0)).catch(console.error)
