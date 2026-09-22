const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMetaCampaigns() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('facebook_token, ad_account_id')
    .eq('id', bioqueId)
    .single();

  const token = profile.facebook_token;
  const actId = profile.ad_account_id;
  const url = `https://graph.facebook.com/v20.0/${actId}/campaigns?fields=id,name,status,objective,created_time&limit=20`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  console.log('Meta Campaigns:\n', JSON.stringify(data, null, 2));
}
checkMetaCampaigns();
