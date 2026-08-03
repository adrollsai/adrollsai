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

async function fixAssetUrlsInDb() {
  console.log("Fetching all assets with '/adrolls-storage/library/' in URL...");
  
  const { data: assets, error } = await supabase
    .from('assets')
    .select('id, url')
    .ilike('url', '%/adrolls-storage/library/%');

  if (error || !assets) {
    console.error("Failed to query assets:", error);
    return;
  }

  console.log(`Found ${assets.length} assets with '/adrolls-storage/library/' in URL.`);

  let updatedCount = 0;
  for (const asset of assets) {
    const fixedUrl = asset.url.replace('/adrolls-storage/library/', '/library/');
    console.log(`Fixing ID ${asset.id}:\n  Old: ${asset.url}\n  New: ${fixedUrl}`);
    
    const { error: updateErr } = await supabase
      .from('assets')
      .update({ url: fixedUrl })
      .eq('id', asset.id);

    if (updateErr) {
      console.error(`Failed to update asset ${asset.id}:`, updateErr);
    } else {
      updatedCount++;
    }
  }

  console.log(`SUCCESS! Fixed ${updatedCount} asset URLs in database.`);
}

fixAssetUrlsInDb();
