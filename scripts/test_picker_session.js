const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

// In CommonJS, let's load or implement token generation
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

async function runTest() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const campaignId = 'e26dfc77-15ea-451f-a0a9-c2d1036238bb';
  const phone = '918288835235';

  const token = createToken({ userId, campaignId, phone });
  console.log('Generated Token:', token.substring(0, 30) + '...');

  // 1. Test GET endpoint locally via node fetch
  const getUrl = `http://localhost:3000/api/creatives/picker-session?token=${token}`;
  console.log(`Testing GET: ${getUrl}`);

  const getRes = await fetch(getUrl);
  const getData = await getRes.json();
  console.log('GET Response Status:', getRes.status);
  console.log('Profile:', getData.profile);
  console.log('Campaign:', getData.campaign);
  console.log('Total Creatives Found:', getData.creatives?.length);
  if (getData.creatives?.length > 0) {
    console.log('Sample creative item:', getData.creatives[0]);
  }

  // 2. Test POST endpoint
  console.log('\nTesting POST /api/creatives/picker-session...');
  const sampleSelection = [
    'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/inventory/bc63c065-9bcc-4793-bedc-f0960406425b/1789292582076_img.jpg',
    'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/inventory/bc63c065-9bcc-4793-bedc-f0960406425b/1789290368044_img.jpg'
  ];

  const postRes = await fetch('http://localhost:3000/api/creatives/picker-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      selectedUrls: sampleSelection
    })
  });

  const postData = await postRes.json();
  console.log('POST Response Status:', postRes.status);
  console.log('POST Data:', postData);
}

runTest().catch(console.error);
