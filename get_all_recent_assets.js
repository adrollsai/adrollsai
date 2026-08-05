const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function listRecent() {
  const { data: assets, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('user_id', '42d2e0c5-4fe6-4738-8a9f-63f09be01f12')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !assets) {
    console.error("Query error:", error);
    return;
  }

  assets.forEach(a => {
    console.log(`\nID: ${a.id} | Status: ${a.status} | CreatedAt: ${a.created_at}`);
    console.log(`URL: ${a.url}`);
    console.log(`Metadata:`, JSON.stringify(a.metadata, null, 2));
  });
}

listRecent();
