const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendTest() {
  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
    .eq('id', nobogentId)
    .single();

  if (error || !profile) {
    console.error('Failed to get Nobogent profile:', error);
    return;
  }

  const phoneId = profile.whatsapp_phone_number_id || '1185499271314063';
  const token = profile.whatsapp_access_token || profile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const targetPhone = '918288835235';
  const imageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/user_assets/bc63c065-9bcc-4793-bedc-f0960406425b/halloween_offer_1793444422001.jpg';

  console.log(`Sending Nobogent "halloween" template to ${targetPhone}...`);
  console.log(`Phone ID: ${phoneId}`);
  console.log(`Image URL: ${imageUrl}`);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: targetPhone,
    type: 'template',
    template: {
      name: 'halloween',
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

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log('Status code:', res.status);
  console.log('Response body:', JSON.stringify(data, null, 2));

  if (res.ok && data.messages?.[0]?.id) {
    console.log(`\n✅ SUCCESS! Message sent to ${targetPhone}. Message ID: ${data.messages[0].id}`);
  } else {
    console.error('\n❌ FAILED to send template message:', data);
  }
}

sendTest().catch(console.error);

