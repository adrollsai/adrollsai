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

async function checkAssetUrls() {
  const { data: assets } = await supabase
    .from('assets')
    .select('id, url, caption, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log("Recent 10 asset URLs in Supabase:");
  assets.forEach(a => {
    console.log(`- ID: ${a.id} | Caption: ${a.caption} | URL: ${a.url}`);
  });
}

checkAssetUrls();
