const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function mapMetaCampaigns() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram account
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const adAccountId = profile.facebook_ad_account_id;

  console.log("Fetching live Meta campaigns for Ad Account:", adAccountId);

  if (token && adAccountId) {
    const actId = adAccountId.replace('act_', '');
    const res = await fetch(`https://graph.facebook.com/v20.0/act_${actId}/campaigns?fields=id,name,status,objective&limit=100&access_token=${token}`);
    const data = await res.json();
    console.log("Meta API Campaigns Result:\n", JSON.stringify(data.data, null, 2));
  } else {
    console.log("No token or adAccountId found!");
  }
}

mapMetaCampaigns();
