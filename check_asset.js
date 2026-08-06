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

async function checkAllTasks() {
  const assetId = 'e1f82e62-0117-4699-95b7-f41bfc1ec93d';
  const { data: tasks } = await supabase
    .from('video_tasks')
    .select('*')
    .eq('asset_id', assetId);

  console.log("All tasks for asset:", JSON.stringify(tasks, null, 2));
}

checkAllTasks();
