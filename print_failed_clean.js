const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function printFailed() {
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

  const failed = assets.filter(a => a.status === 'Failed' || (a.caption && a.caption.includes('Error:')));
  console.log(`=== FOUND ${failed.length} FAILED ASSET(S) IN SUPABASE DB ===`);
  failed.forEach(a => {
    console.log(`\nASSET ID: ${a.id}`);
    console.log(`STATUS: ${a.status}`);
    console.log(`CREATED AT: ${a.created_at}`);
    console.log(`CAPTION / ERROR MSG: ${a.caption}`);
    console.log(`METADATA ERROR: ${a.metadata?.error}`);
  });
}

printFailed();
