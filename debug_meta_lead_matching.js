const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugMetaMatching() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram account
  const { data: leads } = await supabaseAdmin.from('leads').select('id, name, phone, campaign_id, ad_name, custom_fields').eq('user_id', userId);

  console.log(`Total leads: ${leads?.length || 0}`);

  // Let's inspect lead.campaign_id values
  const byCId = {};
  for (const l of leads || []) {
    byCId[l.campaign_id] = (byCId[l.campaign_id] || 0) + 1;
  }
  console.log("Leads by campaign_id:\n", byCId);

  // Print sample custom_fields for leads with campaign_id = 52515251729753
  const villaLeads = (leads || []).filter(l => l.campaign_id === '52515251729753');
  console.log(`\nLeads with campaign_id 52515251729753 (${villaLeads.length}):\n`);
  console.log("Sample 5 villa leads:\n", villaLeads.slice(0, 5));
}

debugMetaMatching();
