const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findCampaignNames() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram account

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, campaign_id, ad_name, custom_fields')
    .eq('user_id', userId);

  console.log(`Total leads for Khushi Ram: ${leads?.length || 0}`);

  const campaignMap = {};
  for (const l of leads || []) {
    let metaOrigin = {};
    if (typeof l.custom_fields === 'object' && l.custom_fields?.meta_ad_origin) {
      metaOrigin = l.custom_fields.meta_ad_origin;
    } else if (typeof l.custom_fields === 'string') {
      try {
        const parsed = JSON.parse(l.custom_fields);
        if (parsed.meta_ad_origin) metaOrigin = parsed.meta_ad_origin;
      } catch (e) {}
    }

    const cId = l.campaign_id || metaOrigin.campaign_id || 'UNKNOWN';
    const cName = metaOrigin.campaign_name || l.ad_name || 'NO_NAME';

    if (!campaignMap[cId]) {
      campaignMap[cId] = { count: 0, names: new Set() };
    }
    campaignMap[cId].count++;
    if (cName) campaignMap[cId].names.add(cName);
  }

  console.log("\nExact Campaign Mapping for Khushi Ram leads:\n");
  for (const [cId, data] of Object.entries(campaignMap)) {
    console.log({
      campaign_id: cId,
      lead_count: data.count,
      names: Array.from(data.names)
    });
  }
}

findCampaignNames();
