const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getRChopraCampaigns() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.facebook_token || profile.whatsapp_access_token;

  console.log("Fetching Ad Accounts for rchopra489@gmail.com...");
  const res = await fetch(`https://graph.facebook.com/v20.0/me/adaccounts?fields=id,name,account_id&access_token=${token}`);
  const data = await res.json();
  console.log("Ad Accounts:\n", JSON.stringify(data.data, null, 2));

  if (data.data && data.data.length > 0) {
    for (const acc of data.data) {
      const cRes = await fetch(`https://graph.facebook.com/v20.0/${acc.id}/campaigns?fields=id,name,status,objective&limit=100&access_token=${token}`);
      const cData = await cRes.json();
      console.log(`\nCampaigns for ${acc.name} (${acc.id}):\n`, cData.data);
    }
  }
}

getRChopraCampaigns();
