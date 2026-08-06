const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testDeliveries() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com

  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id;

  const testPhone = '918288835235';
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  console.log(`Checking profile ${profile.email}... Phone ID: ${phoneId}`);

  // Test 1: Send standard text message to test number
  console.log("\n1. Testing plain text message...");
  const textPayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: testPhone,
    type: 'text',
    text: { body: "Hello Rahul! This is a test message from Nobogent AI." }
  };

  const textRes = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(textPayload)
  });
  const textData = await textRes.json();
  console.log("Text Message Response:\n", JSON.stringify(textData, null, 2));

  // Test 2: Send Approved Template (guaranteed delivery even outside 24h window)
  console.log("\n2. Testing Approved Meta Template message...");
  const templatePayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: testPhone,
    type: 'template',
    template: {
      name: 'booking_notification_admin',
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Rahul Chopra' },
            { type: 'text', text: new Date().toLocaleString('en-IN') },
            { type: 'text', text: 'Nobogent' },
            { type: 'text', text: '+918288835235' },
            { type: 'text', text: 'https://app.nobogent.com' }
          ]
        }
      ]
    }
  };

  const tmplRes = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(templatePayload)
  });
  const tmplData = await tmplRes.json();
  console.log("Template Message Response:\n", JSON.stringify(tmplData, null, 2));
}

testDeliveries();
