const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectRenderUrl() {
  const userId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';

  const { data: assets, error } = await supabaseAdmin
    .from('assets')
    .select('id, status, caption, metadata, created_at, url')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const failed = assets.find(a => a.status === 'Failed' || (a.caption && a.caption.includes('Error:')));
  if (failed) {
    console.log("=== FAILED ASSET DETAILS ===");
    console.log("Failed Asset ID:", failed.id);
    console.log("Failed Asset URL:", failed.url);
    console.log("Failed Error Msg:", failed.metadata?.error || failed.caption);
    const originalAssetId = failed.metadata?.originalAssetId;
    console.log("Original Asset ID:", originalAssetId);
    if (originalAssetId) {
      const { data: orig } = await supabaseAdmin.from('assets').select('*').eq('id', originalAssetId).single();
      console.log("Original Asset URL:", orig?.url);
    }
  }
}

inspectRenderUrl();
