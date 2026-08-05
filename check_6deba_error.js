const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspect6deba() {
  const { data: asset, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('id', '6deba2cb-2f3f-4b5d-a3c2-24d34ae03bb7')
    .single();

  if (error || !asset) {
    console.error(error);
    return;
  }

  console.log("=== ASSET 6deba2cb DETAILS ===");
  console.log("Status:", asset.status);
  console.log("Caption:", asset.caption);
  console.log("Error in Metadata:", asset.metadata?.error);
  console.log("Full Metadata:", JSON.stringify(asset.metadata, null, 2));
}

inspect6deba();
