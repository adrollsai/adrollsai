const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findFailed() {
  const userId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';

  const { data: assets, error } = await supabaseAdmin
    .from('assets')
    .select('id, status, caption, metadata, created_at, url')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Total DB assets for GNR Homes (${userId}):`, assets.length);
  const failed = assets.filter(a => a.status === 'Failed' || (a.caption && a.caption.includes('Error:')));
  console.log(`Found ${failed.length} failed assets in DB:`);
  failed.forEach(a => {
    console.log(`- ID: ${a.id} | Status: ${a.status} | CreatedAt: ${a.created_at}`);
    console.log(`  Caption: ${a.caption}`);
    console.log(`  URL: ${a.url}`);
    console.log(`  Metadata:`, JSON.stringify(a.metadata));
  });
}

findFailed();
