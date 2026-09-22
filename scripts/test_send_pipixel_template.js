const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function testSingleSend() {
  const phoneId = '1301187456416800'; // PiPixel WhatsApp Phone ID
  const token = process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const testPhone = '918288835235'; // Developer test phone
  const templateName = 'immigration_trial';
  const imageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/c7bede84-d7ea-4b02-bbbb-017d24a37914/1790064783995-ChatGPTImageSep222026014241PM.jpg';

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: testPhone,
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

  console.log(`Sending test template to +${testPhone}...`);
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const resData = await res.json();
  console.log('Result:\n', JSON.stringify(resData, null, 2));
}

testSingleSend();
