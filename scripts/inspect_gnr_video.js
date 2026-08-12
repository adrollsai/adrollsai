const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectLatestAssets() {
  console.log("=== INSPECTING 5 MOST RECENT ASSETS ACROSS ALL USERS ===");

  const { data: assets } = await supabase
    .from('assets')
    .select('id, user_id, title, status, file_url, audio_url, voiceover_url, created_at, metadata')
    .order('created_at', { ascending: false })
    .limit(5);

  for (const a of assets || []) {
    console.log(`\nAsset ID: ${a.id}`);
    console.log(`  User ID: ${a.user_id}`);
    console.log(`  Title: ${a.title}`);
    console.log(`  Status: ${a.status}`);
    console.log(`  File URL: ${a.file_url}`);
    console.log(`  Audio URL: ${a.audio_url}`);
    console.log(`  Voiceover URL: ${a.voiceover_url}`);
    console.log(`  Created At: ${a.created_at}`);
    console.log(`  Metadata:`, JSON.stringify(a.metadata, null, 2));
  }
}

inspectLatestAssets().catch(console.error);
