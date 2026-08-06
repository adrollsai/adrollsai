const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectMetaLeads() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const targetMetaId = '52515251729753'; // Luxury Villa Plots campaign

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, campaign_id, custom_fields, created_at')
    .eq('user_id', userId);

  const matched = (leads || []).filter(l => {
    if (l.campaign_id === targetMetaId || l.campaign_id === Number(targetMetaId)) return true;
    if (l.custom_fields) {
      const str = typeof l.custom_fields === 'string' ? l.custom_fields : JSON.stringify(l.custom_fields);
      if (str.includes(targetMetaId)) return true;
    }
    return false;
  });

  console.log(`Total Leads matching Meta Campaign ${targetMetaId}: ${matched.length}`);

  const phoneMap = {};
  for (const l of matched) {
    const rawPhone = l.phone || 'NO_PHONE';
    const normPhone = rawPhone.replace(/\D/g, '').slice(-10) || 'NO_PHONE';
    if (!phoneMap[normPhone]) phoneMap[normPhone] = [];
    phoneMap[normPhone].push(l);
  }

  const uniquePhones = Object.keys(phoneMap).filter(p => p !== 'NO_PHONE');
  console.log(`Unique Phone Numbers matching Meta Campaign ${targetMetaId}: ${uniquePhones.length}`);

  console.log("\nSample 10 Phone Numbers and duplicate counts:");
  Object.entries(phoneMap).slice(0, 10).forEach(([phone, list]) => {
    console.log(`Phone: ${phone} | Count: ${list.length} | Names: ${list.map(x => x.name).join(', ')}`);
  });
}

inspectMetaLeads();
