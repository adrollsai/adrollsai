const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTokens() {
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('*');

  console.log(`Total profiles: ${profiles?.length || 0}`);
  for (const p of profiles || []) {
    console.log({
      id: p.id,
      email: p.email,
      name: p.business_name,
      hasFbToken: !!p.facebook_token,
      adAccount: p.facebook_ad_account_id,
      pageId: p.facebook_page_id
    });
  }
}

checkTokens();
