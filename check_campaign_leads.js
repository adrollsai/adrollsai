const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCampaignLeads() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram account
  const campaignId = '52515251729753';

  // 1. Query Supabase leads for this user and campaign
  console.log("=== 1. SUPABASE DATABASE LEADS ===");
  const { data: dbLeads, count: dbCount } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, ad_campaign_name, meta_campaign_id, source, created_at', { count: 'exact' })
    .eq('user_id', userId);

  console.log(`Total leads in Supabase for Khushi Ram account: ${dbCount}`);

  const campaignLeads = (dbLeads || []).filter(l => 
    l.meta_campaign_id === campaignId || 
    (l.ad_campaign_name && l.ad_campaign_name.toLowerCase().includes('villa')) ||
    (l.ad_campaign_name && l.ad_campaign_name.toLowerCase().includes('khushi ram'))
  );

  console.log(`Leads matching 'Villa Plots / 52515251729753' in Supabase: ${campaignLeads.length}`);
  console.log("Sample DB Leads:\n", campaignLeads.slice(0, 10).map(l => ({ name: l.name, phone: l.phone, source: l.source, campaign: l.ad_campaign_name, created_at: l.created_at })));

  // 2. Query Meta Insights API for campaign 52515251729753
  console.log("\n=== 2. META GRAPH API RAW INSIGHTS ===");
  const { data: profile } = await supabaseAdmin.from('profiles').select('selected_page_token, facebook_token').eq('id', userId).single();
  const token = profile?.selected_page_token || profile?.facebook_token;

  if (token) {
    const metaUrl = `https://graph.facebook.com/v20.0/${campaignId}/insights?fields=actions,action_values,spend,impressions,clicks&date_preset=maximum&access_token=${token}`;
    const res = await fetch(metaUrl);
    const data = await res.json();
    console.log("Raw Meta Insights API Data:\n", JSON.stringify(data, null, 2));

    // Also check adset level insights
    const adsetMetaUrl = `https://graph.facebook.com/v20.0/${campaignId}/adsets?fields=id,name,insights{actions,spend,impressions,clicks}&access_token=${token}`;
    const adsetRes = await fetch(adsetMetaUrl);
    const adsetData = await adsetRes.json();
    console.log("\nRaw Meta Adsets Insights Data:\n", JSON.stringify(adsetData, null, 2));
  } else {
    console.error("No Facebook token for Khushi Ram profile!");
  }
}

checkCampaignLeads();
