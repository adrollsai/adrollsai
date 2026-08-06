const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testDedup() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const targetMeta = '52515251729753|The Khushi Ram Realtors & Developers - Luxary Villa Plots  - 2026-06-27 - 6111';

  const { data: allLeads } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', userId);

  console.log(`Total Leads in DB for Khushi Ram: ${allLeads?.length || 0}`);

  const targetId = targetMeta.includes('|') ? targetMeta.split('|')[0].trim() : targetMeta.trim();
  const targetName = targetMeta.includes('|') ? targetMeta.split('|')[1].trim() : targetMeta.trim();

  const filteredLeads = (allLeads || []).filter(lead => {
    let match = false;
    if (lead.campaign_id && (lead.campaign_id === targetId || lead.campaign_id === targetMeta)) match = true;
    if (lead.ad_name && (lead.ad_name === targetName || lead.ad_name === targetMeta)) match = true;
    if (lead.custom_fields) {
      const cfStr = typeof lead.custom_fields === 'string' ? lead.custom_fields : JSON.stringify(lead.custom_fields);
      if (cfStr.includes(`"campaign_id":"${targetId}"`) || cfStr.includes(`"campaign_id": "${targetId}"`) || cfStr.includes(targetId)) {
        match = true;
      }
    }
    return match;
  });

  console.log(`Filtered Rows matching Meta Campaign ${targetId}: ${filteredLeads.length}`);

  const uniquePhoneMap = new Map();
  for (const lead of filteredLeads) {
    if (!lead.phone) continue;
    const normPhone = lead.phone.replace(/\D/g, '').slice(-10);
    if (!normPhone || normPhone.length < 10 || /^0+$/.test(normPhone)) continue;
    if (!uniquePhoneMap.has(normPhone)) {
      uniquePhoneMap.set(normPhone, lead);
    }
  }

  const targetLeads = Array.from(uniquePhoneMap.values());
  console.log(`Unique Phone Numbers extracted: ${targetLeads.length}`);
}

testDedup();
