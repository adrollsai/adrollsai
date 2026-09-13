const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const crypto = require('crypto');
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXTAUTH_SECRET || 'nobogent_creative_session_secret_key_2026';

function createToken(payload) {
  const fullPayload = {
    ...payload,
    exp: Date.now() + 48 * 60 * 60 * 1000
  };
  const payloadStr = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');
  return `${payloadStr}.${signature}`;
}

async function sendPickerMessage() {
  const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, whatsapp_personal_number, whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  const recipient = (profile.whatsapp_personal_number || '').replace(/\D/g, '');
  const tokenStr = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id;

  const sessionToken = createToken({
    userId: profile.id,
    campaignId: 'e26dfc77-15ea-451f-a0a9-c2d1036238bb',
    phone: recipient
  });

  const pickerUrl = `https://app.nobogent.com/select-creatives?token=${sessionToken}`;
  console.log(`Sending Webview Picker message to ${recipient}...`);
  console.log('Picker URL:', pickerUrl);

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenStr}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        header: {
          type: 'text',
          text: '🎨 Select Campaign Creatives'
        },
        body: {
          text: `We found 200+ creatives in your library!\n\nTap the button below to view full visual previews, filter by *Images*, *Videos*, *AI Generated*, or upload from your camera roll:\n\n🔗 Direct Link:\n${pickerUrl}`
        },
        footer: {
          text: 'Nobogent AI'
        },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: 'Select Creatives 🎨',
            url: pickerUrl
          }
        }
      }
    })
  });

  const data = await res.json();
  console.log('Send Result:', JSON.stringify(data, null, 2));
}

sendPickerMessage().catch(console.error);
