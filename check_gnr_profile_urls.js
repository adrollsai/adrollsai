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
    if (!url || !url.startsWith('http')) return resolve(200);
    try {
      https.get(url, { method: 'HEAD' }, (res) => {
        resolve(res.statusCode);
      }).on('error', () => resolve(500));
    } catch (e) {
      resolve(500);
    }
  });
}

async function checkProfileUrls() {
  const userId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  console.log("=== PROFILE DETAILS FOR GNR HOMES ===");
  console.log("Business Name:", profile.business_name);
  console.log("Logo URL:", profile.logo_url);
  console.log("Avatar URL:", profile.avatar_url);
  console.log("Business Info:", profile.business_info?.substring(0, 100));

  if (profile.logo_url) {
    const code = await checkUrl(profile.logo_url);
    console.log(`Logo URL HTTP Status: ${code}`);
  }
  if (profile.avatar_url) {
    const code = await checkUrl(profile.avatar_url);
    console.log(`Avatar URL HTTP Status: ${code}`);
  }
}

checkProfileUrls();
