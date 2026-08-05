const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resetCampaignLeads() {
  const campaignId = '21a9103d-03ba-41c7-8625-7923b4f792ce'; // Latest Farmhouse campaign

  console.log(`Resetting call status for campaign ${campaignId}...`);
  const { data, error } = await supabaseAdmin
    .from('leads')
    .update({
      voice_call_status: null,
      voice_call_retry_count: 0
    })
    .eq('voice_campaign_id', campaignId)
    .select('id');

  if (error) {
    console.error("Error resetting campaign leads:", error);
  } else {
    console.log(`Successfully reset voice_call_status for ${data?.length || 0} leads!`);
  }
}

resetCampaignLeads();
