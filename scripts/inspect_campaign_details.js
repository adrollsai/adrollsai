const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectCampaignDetails() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const { data: profile } = await supabase
    .from('profiles')
    .select('facebook_token')
    .eq('id', bioqueId)
    .single();

  const token = profile.facebook_token;
  const campaignId = '120251733400040304'; // Binghatti Dubai - Luxury Starfall & Residences

  // 1. Get campaign
  const campRes = await fetch(`https://graph.facebook.com/v21.0/${campaignId}?fields=id,name,status,objective,daily_budget,buying_type&access_token=${token}`);
  const camp = await campRes.json();
  console.log('Campaign:', JSON.stringify(camp, null, 2));

  // 2. Get ad sets
  const adsetsRes = await fetch(`https://graph.facebook.com/v21.0/${campaignId}/adsets?fields=id,name,status,targeting,billing_event,optimization_goal,bid_strategy,daily_budget&access_token=${token}`);
  const adsets = await adsetsRes.json();
  console.log('Ad Sets:', JSON.stringify(adsets, null, 2));

  // 3. Get ads and creatives
  const adsRes = await fetch(`https://graph.facebook.com/v21.0/${campaignId}/ads?fields=id,name,status,creative{id,name,title,body,image_url,call_to_action,asset_feed_spec,object_story_spec}&access_token=${token}`);
  const ads = await adsRes.json();
  console.log('Ads & Creative:', JSON.stringify(ads, null, 2));

  // 4. Form
  const formId = '1289794899893214'; // or form used
  const formRes = await fetch(`https://graph.facebook.com/v21.0/120251733401600304?fields=id,name,creative{id,asset_feed_spec,object_story_spec}&access_token=${token}`);
  const formData = await formRes.json();
  console.log('Ad 120251733401600304 details:', JSON.stringify(formData, null, 2));
}

inspectCampaignDetails().catch(console.error);
