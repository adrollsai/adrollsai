const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: bioque } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', '68b55a31-a16d-454d-a20f-11adabf590b0')
    .single();

  const token = bioque.facebook_token;
  const campaignId = '120251924470700304';

  const campRes = await (await fetch(`https://graph.facebook.com/v21.0/${campaignId}?fields=id,name,objective,status,daily_budget,lifetime_budget,special_ad_categories&access_token=${token}`)).json();
  console.log('Campaign:', JSON.stringify(campRes, null, 2));

  const adsetsRes = await (await fetch(`https://graph.facebook.com/v21.0/${campaignId}/adsets?fields=id,name,status,daily_budget,targeting,optimization_goal,billing_event,bid_strategy,promoted_object&access_token=${token}`)).json();
  console.log('Adsets Count:', adsetsRes.data?.length);
  adsetsRes.data?.forEach(adset => {
    console.log('----------------------------------------------------');
    console.log('Adset Name:', adset.name);
    console.log('Adset ID:', adset.id);
    console.log('Adset Status:', adset.status);
    console.log('Adset Budget:', adset.daily_budget);
    console.log('Adset Targeting:', JSON.stringify(adset.targeting, null, 2));
  });


  const formId = '1885013402872435';
  const formRes = await (await fetch(`https://graph.facebook.com/v21.0/${formId}?fields=id,name,status,questions,context_card,thank_you_page&access_token=${token}`)).json();
  console.log('Form:', JSON.stringify(formRes, null, 2));

}

main().catch(console.error);
