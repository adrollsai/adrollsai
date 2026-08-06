const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findFailed() {
  const { data: assets, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('status', 'Failed')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log(`TOTAL FAILED ASSETS ACROSS ALL USERS: ${assets.length}`);
  assets.forEach((a, i) => {
    console.log(`\n#${i+1} ID: ${a.id} | User: ${a.user_id} | CreatedAt: ${a.created_at}`);
    console.log(`Error:`, a.metadata?.error);
  });
}

findFailed();
