const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testFixedCampaignInsights() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const campaignId = '52515251729753';

  const { data: profile } = await supabaseAdmin.from('profiles').select('selected_page_token, facebook_token').eq('id', userId).single();
  const token = profile?.selected_page_token || profile?.facebook_token;

  const metaUrl = `https://graph.facebook.com/v20.0/${campaignId}/insights?fields=actions,action_values,spend,impressions,clicks&date_preset=maximum&access_token=${token}`;
  const res = await fetch(metaUrl);
  const data = await res.json();
  const insight = data.data?.[0];

  if (!insight) {
    console.log("No insights found.");
    return;
  }

  const spend = parseFloat(insight.spend || '0');
  const impressions = parseInt(insight.impressions || '0', 10);
  const clicks = parseInt(insight.clicks || '0', 10);

  const leadAction = insight.actions?.find((a) => a.action_type === 'lead');
  const leadGroupedAction = insight.actions?.find((a) => a.action_type === 'onsite_conversion.lead_grouped' || a.action_type === 'offsite_complete_registration_add_meta_leads');
  const waAction = insight.actions?.find((a) => 
    a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
    a.action_type === 'messaging_conversation_started_7d' ||
    a.action_type === 'onsite_conversion.messaging_first_reply' ||
    a.action_type === 'messaging_user_depth_2_message_send' ||
    a.action_type === 'onsite_conversion.total_messaging_connection'
  );

  const leads = leadAction 
    ? parseInt(leadAction.value || '0', 10) 
    : (leadGroupedAction 
      ? parseInt(leadGroupedAction.value || '0', 10) 
      : (waAction ? parseInt(waAction.value || '0', 10) : 0));

  const cpl = leads > 0 ? spend / leads : 0;

  console.log("🎉 NEW CALCULATED METRICS FOR CAMPAIGN " + campaignId + ":");
  console.log(`Spend: ₹${spend.toFixed(2)}`);
  console.log(`Impressions: ${impressions.toLocaleString()}`);
  console.log(`Clicks: ${clicks.toLocaleString()}`);
  console.log(`Total Leads: ${leads}`);
  console.log(`Cost Per Lead (CPL): ₹${cpl.toFixed(2)} / lead`);
}

testFixedCampaignInsights();
