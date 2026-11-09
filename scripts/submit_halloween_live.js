const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function registerHalloweenOnLiveWaba() {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', 'bc63c065-9bcc-4793-bedc-f0960406425b').single();
  const token = profile.facebook_token || profile.whatsapp_access_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const liveWaba = '1015373167918902'; // Nobogent live WABA with phone +91 98771 61216 (1185499271314063)

  // 1. Get sample image buffer
  const localImage = 'C:/Users/Adrolls/.gemini/antigravity/brain/70631b73-661a-48ff-ab48-baf6a5e9a516/.user_uploaded/media_1793442830849_256f35b6.jpg';
  const imgBuffer = fs.readFileSync(localImage);

  // 2. Get App ID
  const appIdRes = await fetch(`https://graph.facebook.com/v21.0/app?access_token=${token}`);
  const appData = await appIdRes.json();
  const appId = appData.id;
  console.log('App ID:', appId);

  // 3. Create upload session
  const sessionRes = await fetch(`https://graph.facebook.com/v21.0/${appId}/uploads?file_length=${imgBuffer.length}&file_type=image/jpeg&access_token=${token}`, {
    method: 'POST'
  });
  const sessionData = await sessionRes.json();
  console.log('Upload session:', sessionData);

  let headerHandle = null;
  if (sessionData.id) {
    const uploadId = sessionData.id;
    const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${uploadId}`, {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${token}`,
        'file_offset': '0'
      },
      body: imgBuffer
    });
    const uploadResult = await uploadRes.json();
    console.log('Upload result:', uploadResult);
    headerHandle = uploadResult.h;
  }

  console.log('Header Handle for template:', headerHandle);
  if (!headerHandle) {
    console.error('Failed to get header handle');
    return;
  }

  // 4. Submit template to live WABA
  const templatePayload = {
    name: 'halloween',
    language: 'en_US',
    category: 'MARKETING',
    components: [
      {
        type: 'HEADER',
        format: 'IMAGE',
        example: {
          header_handle: [headerHandle]
        }
      },
      {
        type: 'BODY',
        text: '🎃 MONTH-END SPECIAL: Get 1000 FREE AI Calling Minutes with Nobogent! 🎉\n\n✨ Included:\n* 📞 1000 Free AI Calling Minutes\n* ⚡ Instant Lead Calling & Qual.\n* 📱 WhatsApp Automated Drips\n* 🎨 AI Marketing Graphics & Ads\n* 🌐 Real Estate Websites\n* 📈 Ads Campaign & CRM Mgt.\n\n🔥 All for just ₹9,999/month! (No setup fees • Cancel anytime)\n👇 Tap to learn more!'
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'QUICK_REPLY',
            text: 'Interested!'
          }
        ]
      }
    ]
  };

  const createRes = await fetch(`https://graph.facebook.com/v21.0/${liveWaba}/message_templates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(templatePayload)
  });

  const createData = await createRes.json();
  console.log('Create template response:', JSON.stringify(createData, null, 2));

  // Check template status
  if (createData.id) {
    const statusRes = await fetch(`https://graph.facebook.com/v21.0/${createData.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const statusData = await statusRes.json();
    console.log('Live Template Status:', statusData.status);
  }
}

registerHalloweenOnLiveWaba().catch(console.error);

