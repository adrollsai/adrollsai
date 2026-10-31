const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTemplate() {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('whatsapp_waba_id, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  if (error || !profile) {
    console.error('Profile fetch error:', error);
    return;
  }

  const token = profile.facebook_token;
  const wabaId = profile.whatsapp_waba_id;
  console.log('Using WABA ID:', wabaId);

  // First, upload a sample image using Resumable Upload API to get a header_handle for the template example
  // Or check if direct handle works
  // Let's create an upload session or use direct URL if supported, or upload session
  const sampleImageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_0.jpg';

  // 1. Get upload session
  console.log('Fetching sample image...');
  const imgRes = await fetch(sampleImageUrl);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

  const appIdRes = await fetch(`https://graph.facebook.com/v21.0/app?access_token=${token}`);
  const appData = await appIdRes.json();
  const appId = appData.id;
  console.log('App ID:', appId);

  console.log('Creating upload session for sample image...');
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

  const templatePayload = {
    name: 'generic_business_update_showcase',
    language: 'en_US',
    category: 'MARKETING',
    components: [
      {
        type: 'HEADER',
        format: 'IMAGE',
        example: {
          header_handle: headerHandle ? [headerHandle] : undefined
        }
      },
      {
        type: 'BODY',
        text: 'Hello {{1}}, here is the exclusive update and latest showcase for {{2}}. We are delighted to share these details with you. If you have any questions or would like to schedule a visit, feel free to reply directly to this message!',
        example: {
          body_text: [['Valued Client', 'Nobogent Luxury Properties']]
        }
      }
    ]
  };

  const createRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(templatePayload)
  });

  const createData = await createRes.json();
  console.log('Create template response:', JSON.stringify(createData, null, 2));
}

createTemplate().catch(console.error);

