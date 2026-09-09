const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function submit() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0'; // Bioque Estates

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('id', userId)
    .single();

  const wabaId = profile.whatsapp_waba_id;
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const appId = process.env.FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;

  console.log(`1. Uploading sample image to Meta for WABA ${wabaId}...`);

  const imageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/campaigns/68b55a31-a16d-454d-a20f-11adabf590b0/dubai-luxury-showcase.jpg';
  const imgRes = await fetch(imageUrl);
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  const sessionRes = await fetch(`https://graph.facebook.com/v20.0/${appId}/uploads?file_length=${buffer.length}&file_type=image/jpeg&access_token=${token}`, {
    method: 'POST'
  });
  const sessionData = await sessionRes.json();
  if (!sessionData.id) {
    console.error('Failed to create upload session:', sessionData);
    return;
  }

  const uploadRes = await fetch(`https://graph.facebook.com/v20.0/${sessionData.id}`, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${token}`,
      'file_offset': '0'
    },
    body: buffer
  });
  const uploadData = await uploadRes.json();
  if (!uploadData.h) {
    console.error('Failed to upload file to Meta:', uploadData);
    return;
  }

  console.log('Got Meta header handle:', uploadData.h);

  const templateName = 'bioque_exclusive_dubai_img_v1';
  const bodyText = `Hello {{1}} ji,\n\n🏙️ Exclusive Dubai Properties — Hand-Picked For You\n\nWe’ve curated a list of selected Dubai properties featuring:\n\n* 📈 High Rental Yield Potential\n* 💰 Festive Offers on Select Properties\n* 📍 Prime Locations\n* 🏢 Top Developers\n\n📋 Want the hand-picked property list?\n\n👉 Click "Interested" and we’ll share it with you.`;

  const templatePayload = {
    name: templateName,
    language: 'en_US',
    category: 'MARKETING',
    components: [
      {
        type: 'HEADER',
        format: 'IMAGE',
        example: {
          header_handle: [uploadData.h]
        }
      },
      {
        type: 'BODY',
        text: bodyText,
        example: {
          body_text: [['Amit']]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'QUICK_REPLY',
            text: 'Interested'
          }
        ]
      }
    ]
  };

  console.log(`2. Submitting template "${templateName}" to Meta WABA...`);
  const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(templatePayload)
  });

  const data = await res.json();
  console.log('Submission Result:\n', JSON.stringify(data, null, 2));
}

submit();
