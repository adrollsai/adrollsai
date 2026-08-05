const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspect6deba() {
  const { data: asset } = await supabaseAdmin
    .from('assets')
    .select('id, status, caption, metadata')
    .eq('id', '6deba2cb-2f3f-4b5d-a3c2-24d34ae03bb7')
    .single();

  if (!asset) {
    console.log("Asset 6deba2cb not found (might have been deleted)");
    return;
  }

  console.log("=== ASSET 6deba2cb METADATA ERROR ===");
  console.log("Error:", asset.metadata?.error);
}

inspect6deba();
