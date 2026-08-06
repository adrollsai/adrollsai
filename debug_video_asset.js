const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAsset() {
  const assetId = 'e1f82e62-0117-4699-95b7-f41bfc1ec93d';

  const { data: asset, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('id', assetId)
    .single();

  if (error || !asset) {
    console.error("Asset query error:", error);
    return;
  }

  console.log("Asset Data:\n", {
    id: asset.id,
    type: asset.type,
    url: asset.url,
    status: asset.status,
    metadata: asset.metadata
  });

  // Test downloading the video file
  const videoUrl = asset.url.startsWith('http') ? asset.url : `https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/${asset.url}`;
  console.log(`Testing fetch for video URL: ${videoUrl}`);

  try {
    const res = await fetch(videoUrl, { method: 'HEAD' });
    console.log(`HTTP HEAD Status: ${res.status}, Content-Type: ${res.headers.get('content-type')}, Content-Length: ${res.headers.get('content-length')}`);
  } catch (err) {
    console.error("HEAD fetch error:", err.message);
  }
}

checkAsset();
