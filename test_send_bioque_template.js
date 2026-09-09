const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSend() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0'; // Bioque Estates
  const recipientPhone = '918288835235';
  const recipientName = 'Rahul';

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('id', userId)
    .single();

  const phoneId = profile.whatsapp_phone_number_id;
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const templateName = 'bioque_exclusive_dubai_img_v1';
  const imageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/campaigns/68b55a31-a16d-454d-a20f-11adabf590b0/dubai_properties_1788934140851.jpeg';

  console.log(`Sending test template "${templateName}" with image to +${recipientPhone}...`);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
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
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: recipientName }
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
    console.log(`✅ Message delivered successfully! Message ID: ${resData.messages[0].id}`);

    // Ensure chat and message are logged in DB
    let { data: chat } = await supabaseAdmin
      .from('whatsapp_chats')
      .select('id')
      .eq('user_id', userId)
      .eq('recipient_phone', recipientPhone)
      .maybeSingle();

    if (!chat) {
      const { data: newChat } = await supabaseAdmin
        .from('whatsapp_chats')
        .insert({
          user_id: userId,
          recipient_phone: recipientPhone,
          recipient_name: recipientName,
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
        message_text: `[Image Header: ${imageUrl}]\n\nHello ${recipientName} ji,\n\n🏙️ Exclusive Dubai Properties — Hand-Picked For You\n\nWe’ve curated a list of selected Dubai properties featuring:\n\n* 📈 High Rental Yield Potential\n* 💰 Festive Offers on Select Properties\n* 📍 Prime Locations\n* 🏢 Top Developers\n\n📋 Want the hand-picked property list?\n\n👉 Click "Interested" and we’ll share it with you.`
      });
    }
  }
}

testSend();
