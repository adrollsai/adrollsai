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

async function checkNobogentAssets() {
  const { data: assets } = await supabase
    .from('assets')
    .select('id, user_id, url, type, caption, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log("Recent assets across all users:");
  assets.forEach(a => {
    console.log(`- ID: ${a.id} | User: ${a.user_id} | Type: ${a.type} | URL: ${a.url}`);
  });
}

checkNobogentAssets();
