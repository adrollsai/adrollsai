const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function submitKhushiTemplate() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram Realtors

  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('id', userId)
    .single();

  if (pErr || !profile) {
    console.error('Failed to load profile:', pErr);
    return;
  }

  const wabaId = profile.whatsapp_waba_id;
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const appId = process.env.FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;

  console.log(`Checking WABA ${wabaId}...`);
  const wabaRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}?access_token=${token}`);
  const wabaInfo = await wabaRes.json();
  console.log('WABA Info:', wabaInfo);

  const localImagePath = 'C:/Users/Adrolls/Downloads/khushi sir.png';
  const buffer = fs.readFileSync(localImagePath);

  console.log(`1. Uploading image sample (${buffer.length} bytes) to Meta for WABA ${wabaId}...`);
  const sessionRes = await fetch(`https://graph.facebook.com/v20.0/${appId}/uploads?file_length=${buffer.length}&file_type=image/png&access_token=${token}`, {
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

  const templateName = 'khushi_mohali_growth_v1';
  const bodyText = `📈 Invest in Mohali’s Growth Story\n\nLooking for a commercial investment with strong potential for rental income + long-term appreciation?\n\n📍 Aerocity, Mohali\n🏢 Ready-to-move commercial properties\n💰 Investment options from ₹70 Lakhs\n📊 Pre-leased options with indicative yield up to ~6% p.a.*\n🏪 Shops | Showrooms | Offices\n\n✨ Prime location. Established commercial ecosystem. Investment opportunities worth exploring.\n\n👉 WhatsApp us to get shortlisted property options\n\n*Yield is indicative and property/lease-specific; terms apply.`;

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
        text: bodyText
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

  console.log(`2. Submitting template "${templateName}" to Meta WABA ${wabaId}...`);
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

  // Check template status
  if (data.id) {
    console.log('\n3. Checking approval status...');
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await fetch(`https://graph.facebook.com/v20.0/${data.id}?access_token=${token}`);
    const statusData = await statusRes.json();
    console.log('Template Details:', statusData);
  }
}

submitKhushiTemplate().catch(console.error);
