const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FACEBOOK_GRAPH_URL = 'https://graph.facebook.com/v19.0';

async function testVideoPost() {
  const { data: p } = await s.from('profiles').select('selected_page_id, selected_page_token, facebook_token').eq('id', 'bc63c065-9bcc-4793-bedc-f0960406425b').single();
  const fbToken = p.selected_page_token || p.facebook_token;
  const pageId = p.selected_page_id;
  const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/renders/bc63c065-9bcc-4793-bedc-f0960406425b/6085a45c-79d9-4ab5-bd0d-a21e57cda4bf.mp4';

  console.log('--- Testing Facebook Video Endpoint ---');
  // In stitcher/index.js:
  // endpoint: ${FACEBOOK_GRAPH_URL}/${pageId}/videos
  // body: { access_token: accessToken, file_url: cleanMediaUrl, description: caption }
  const fbEndpoint = `${FACEBOOK_GRAPH_URL}/${pageId}/videos`;
  console.log('Calling FB endpoint:', fbEndpoint);
  
  const fbRes = await fetch(fbEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: fbToken,
      file_url: videoUrl,
      description: 'Test post check'
    })
  });
  const fbData = await fbRes.json();
  console.log('FB Video Response:', JSON.stringify(fbData, null, 2));

  console.log('\n--- Testing Instagram Container Endpoint ---');
  const igAccountId = '17841447733185655';
  const igRes = await fetch(`${FACEBOOK_GRAPH_URL}/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caption: 'Test post check',
      access_token: fbToken,
      video_url: videoUrl,
      media_type: 'REELS'
    })
  });
  const igData = await igRes.json();
  console.log('IG Media Container Response:', JSON.stringify(igData, null, 2));
}

testVideoPost().catch(console.error);
