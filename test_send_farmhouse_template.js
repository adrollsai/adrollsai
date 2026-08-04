const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSendFarmhouseTemplate() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram account

  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id; // 1222478707610202

  const testPhone = '918288835235';
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  const pdfUrl = 'https://app.nobogent.com/api/fetch-image?url=https%3A%2F%2Fpub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev%2Flibrary%2Fd838c956-1761-4bce-9d91-32f3abecc222%2F1785820062907-FarmHouse-FunctionalDevelopment290324.pdf';

  console.log(`Sending farmhouse_luxury_brochure template from Khushi Ram WABA (${phoneId}) to ${testPhone}...`);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: testPhone,
    type: 'template',
    template: {
      name: 'farmhouse_luxury_brochure',
      language: { code: 'hi' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Rahul Chopra' },
            { type: 'text', text: pdfUrl }
          ]
        }
      ]
    }
  };

  const res = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log(`Meta API Status: ${res.status}`);
  console.log("Meta API Response:\n", JSON.stringify(data, null, 2));
}

testSendFarmhouseTemplate();
