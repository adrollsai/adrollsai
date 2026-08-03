const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
envText.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=');
  if (key && vals.length) env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

async function testCaptionGeneration() {
  const assetId = '98dce43f-c296-4cad-b1c2-433bf2612054';
  const { data: asset } = await supabase.from('assets').select('*').eq('id', assetId).single();

  console.log("Testing caption generation for asset:", asset);

  const testUrl = asset.url;
  console.log("Fetching media from asset URL:", testUrl);
  
  const res = await fetch(testUrl);
  console.log("Fetch Status:", res.status);

  if (res.ok) {
    console.log("SUCCESS! Media file fetched cleanly with HTTP 200 OK!");
  } else {
    console.error("Fetch failed with status:", res.status);
  }
}

testCaptionGeneration();
