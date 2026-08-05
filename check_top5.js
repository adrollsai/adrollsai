const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function checkUrl(url) {
  return new Promise((resolve) => {
    try {
      https.get(url, { method: 'HEAD' }, (res) => {
        resolve(res.statusCode);
      }).on('error', () => resolve(500));
    } catch (e) {
      resolve(500);
    }
  });
}

async function checkTop5() {
  const userId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';

  const { data: assets } = await supabaseAdmin
    .from('assets')
    .select('id, status, url, created_at, caption')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log("=== TOP 5 LATEST ASSETS FOR GNR HOMES ===");
  for (const a of assets) {
    const code = a.url ? await checkUrl(a.url) : 'NO_URL';
    console.log(`[HTTP ${code}] ID: ${a.id} | Status: ${a.status} | CreatedAt: ${a.created_at}`);
    console.log(`         URL: ${a.url}`);
    if (a.status === 'Failed') {
      console.log(`         Caption: ${a.caption}`);
    }
  }
}

checkTop5();
