const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendTestMessage() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram Realtors
  const testRecipient = '918288835235';

  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('id', userId)
    .single();

  if (pErr || !profile) {
    console.error('Failed to load profile:', pErr);
    return;
  }

  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id;
  const templateName = 'khushi_mohali_growth_v1';
  const imageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/campaigns/d838c956-1761-4bce-9d91-32f3abecc222/khushi_commercial_aerocity_1788953130262.png';

  console.log(`Sending test template "${templateName}" to +${testRecipient} via Khushi Ram Phone ID ${phoneId}...`);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: testRecipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en_US' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'image',
              image: { link: imageUrl }
            }
          ]
        }
      ]
    }
  };

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const resData = await res.json();
  console.log('Send Result:\n', JSON.stringify(resData, null, 2));

  if (res.ok && resData.messages?.[0]?.id) {
    const msgId = resData.messages[0].id;
    console.log(`\n🎉 Test message successfully sent to +${testRecipient}! Message ID: ${msgId}`);

    // Log chat and message in Supabase
    let { data: chat } = await supabaseAdmin
      .from('whatsapp_chats')
      .select('id')
      .eq('user_id', userId)
      .eq('recipient_phone', testRecipient)
      .maybeSingle();

    if (!chat) {
      const { data: newChat } = await supabaseAdmin
        .from('whatsapp_chats')
        .insert({
          user_id: userId,
          recipient_phone: testRecipient,
          recipient_name: 'Rahul (Test)',
          last_message_text: `[Template: ${templateName}]`
        })
        .select('id')
        .single();
      chat = newChat;
    }

    if (chat) {
      await supabaseAdmin.from('whatsapp_messages').insert({
        chat_id: chat.id,
        direction: 'outbound',
        message_text: `[Image Header: ${imageUrl}]\n\n📈 Invest in Mohali’s Growth Story\n\nLooking for a commercial investment with strong potential for rental income + long-term appreciation?\n\n📍 Aerocity, Mohali\n🏢 Ready-to-move commercial properties\n💰 Investment options from ₹70 Lakhs\n📊 Pre-leased options with indicative yield up to ~6% p.a.*\n🏪 Shops | Showrooms | Offices\n\n✨ Prime location. Established commercial ecosystem. Investment opportunities worth exploring.\n\n👉 WhatsApp us to get shortlisted property options\n\n*Yield is indicative and property/lease-specific; terms apply.`
      });
    }

    return { success: true, messageId: msgId };
  } else {
    console.error('Failed to send:', resData);
    return { success: false, error: resData };
  }
}

if (require.main === module) {
  sendTestMessage().catch(console.error);
}

module.exports = { sendTestMessage };
