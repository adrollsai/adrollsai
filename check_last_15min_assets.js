const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRecentAssets() {
  const { data: assets, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error("Error fetching assets:", error);
    return;
  }

  console.log(`Found ${assets.length} most recent assets across all users:`);
  assets.forEach((a, i) => {
    console.log(`\n#${i+1} Asset ID: ${a.id} | User: ${a.user_id} | Status: ${a.status} | Type: ${a.type} | CreatedAt: ${a.created_at}`);
    console.log(`URL: ${a.url}`);
    console.log(`Caption: ${a.caption}`);
    console.log(`Metadata:`, JSON.stringify(a.metadata, null, 2));
  });
}

checkRecentAssets();
