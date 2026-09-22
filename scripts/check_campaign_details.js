const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCampaignDetails() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('facebook_token, ad_account_id')
    .eq('id', bioqueId)
    .single();

  const token = profile.facebook_token;
  const campaignId = '120251551605320304';
  
  // 1. Get AdSets
  const adsetsRes = await fetch(`https://graph.facebook.com/v20.0/${campaignId}/adsets?fields=id,name,status,destination_type,promoted_object`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('AdSets:', await adsetsRes.json());

  // 2. Get Ads
  const adsRes = await fetch(`https://graph.facebook.com/v20.0/${campaignId}/ads?fields=id,name,status,creative{id,name,asset_feed_spec,object_story_spec}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('Ads:', JSON.stringify(await adsRes.json(), null, 2));
}
checkCampaignDetails();
