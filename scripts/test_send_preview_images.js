const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendPreview() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, whatsapp_personal_number, whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  const recipient = (profile.whatsapp_personal_number || '').replace(/\D/g, '');
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id;

  const flyerUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/inventory/bc63c065-9bcc-4793-bedc-f0960406425b/1789292582076_img.jpg';

  console.log(`Sending image preview to ${recipient}...`);

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'image',
      image: {
        link: flyerUrl,
        caption: '🖼️ *[Creative #1]* Nobogent Real Estate AI Automation Flyer'
      }
    })
  });

  const data = await res.json();
  console.log('Send Image Result:', JSON.stringify(data, null, 2));
}

sendPreview().catch(console.error);
