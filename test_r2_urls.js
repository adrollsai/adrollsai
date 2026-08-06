const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testUrls() {
  const assetId = 'e1f82e62-0117-4699-95b7-f41bfc1ec93d';
  const { data: asset } = await supabaseAdmin.from('assets').select('*').eq('id', assetId).single();

  console.log("Asset URL:", asset.url);
  console.log("Asset metadata:", JSON.stringify(asset.metadata, null, 2));

  // Test fetch asset.url
  const res1 = await fetch(asset.url, { method: 'HEAD' });
  console.log(`asset.url HEAD status: ${res1.status}`);

  // If metadata has broken video URL references, let's check them
  if (asset.metadata?.stitchedVideoUrl) {
    const res2 = await fetch(asset.metadata.stitchedVideoUrl, { method: 'HEAD' });
    console.log(`stitchedVideoUrl HEAD status: ${res2.status}`);
  }
}

testUrls();
