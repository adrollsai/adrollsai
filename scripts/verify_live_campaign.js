const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verify() {
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f').single();
  const token = profile.facebook_token;

  const campRes = await fetch(`https://graph.facebook.com/v21.0/52579930252669?fields=id,name,status,objective,daily_budget,adsets{id,name,status,targeting,ads{id,name,status}}&access_token=${token}`);
  const campData = await campRes.json();
  console.log('Live Campaign Verification:');
  console.log(JSON.stringify(campData, null, 2));
}

verify().catch(console.error);
