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

async function checkFailedAssets() {
  const userId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
  console.log("Fetching recent assets for GNR Homes...");
  
  const { data: assets } = await supabase
    .from('assets')
    .select('id, status, caption, created_at, metadata')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log("Recent assets:", JSON.stringify(assets, null, 2));

  const { data: tasks } = await supabase
    .from('video_tasks')
    .select('*')
    .eq('user_id', userId);

  console.log("Video tasks:", JSON.stringify(tasks, null, 2));
}

checkFailedAssets();
