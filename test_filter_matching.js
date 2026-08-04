const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testFilter() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const { data: leads } = await supabaseAdmin.from('leads').select('*').eq('user_id', userId);

  // If filter stores ID or ID|name or exact campaign_id
  const selectedMetaCampaigns = ["52515251729753"];

  const matched = leads.filter(lead => {
    for (const targetMeta of selectedMetaCampaigns) {
      if (!targetMeta) continue;
      const [targetId, targetName] = targetMeta.includes('|') ? targetMeta.split('|') : [targetMeta, targetMeta];

      // 1. Direct campaign_id match
      if (lead.campaign_id && (lead.campaign_id === targetId || lead.campaign_id === targetMeta)) {
        return true;
      }
    }
    return false;
  });

  console.log(`\nExact Campaign ID Filtered Leads Count: ${matched.length}`);
}

testFilter();
