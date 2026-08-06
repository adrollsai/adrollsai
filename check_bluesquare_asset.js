const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRecentAsset() {
  const { data: assets } = await supabaseAdmin
    .from('assets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log("=== MOST RECENT 5 GENERATED ASSETS ===");
  assets.forEach(a => {
    console.log(`\nID: ${a.id} | User: ${a.user_id} | Status: ${a.status}`);
    console.log(`Title: ${a.title}`);
    console.log(`Metadata:`, JSON.stringify(a.metadata, null, 2));
    console.log(`Video URL:`, a.url || a.video_url);
  });
}

checkRecentAsset();
