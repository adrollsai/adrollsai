require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAllHarmanActionsToday() {
  const harmanId = '7ce0408f-b03f-4af8-a32d-852b6c22da2a';
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);

  // 1. Get all lead IDs assigned to Harman
  const { data: harmanLeads } = await supabaseAdmin
    .from('leads')
    .select('id, name')
    .or(`assigned_to.eq.${harmanId},user_id.eq.${harmanId}`);

  const leadIds = harmanLeads ? harmanLeads.map(l => l.id) : [];
  console.log(`Harman total assigned leads: ${leadIds.length}`);

  // 2. Fetch history entries for Harman's leads created today (regardless of who created the history entry)
  let allHistoryOnHarmanLeads = [];
  // batch in chunks of 500
  for (let i = 0; i < leadIds.length; i += 500) {
    const chunk = leadIds.slice(i, i + 500);
    const { data: logs } = await supabaseAdmin
      .from('lead_history')
      .select('id, lead_id, user_id, action_type, description, created_at')
      .in('lead_id', chunk)
      .gte('created_at', startOfDay.toISOString());

    if (logs) allHistoryOnHarmanLeads = allHistoryOnHarmanLeads.concat(logs);
  }

  console.log(`Total lead_history entries on Harman's leads today: ${allHistoryOnHarmanLeads.length}`);
  
  const userMap = {};
  allHistoryOnHarmanLeads.forEach(h => {
    userMap[h.user_id] = (userMap[h.user_id] || 0) + 1;
  });
  console.log('History logged by user_id breakdown on Harman leads today:', userMap);

  // 3. Check if any history logs today have Harman's name in description but different user_id
  const { data: logsWithHarmanName } = await supabaseAdmin
    .from('lead_history')
    .select('id, lead_id, user_id, action_type, description, created_at')
    .ilike('description', '%Harman%')
    .gte('created_at', startOfDay.toISOString());

  console.log(`Total history entries mentioning "Harman" in description today: ${logsWithHarmanName ? logsWithHarmanName.length : 0}`);
  if (logsWithHarmanName) {
    logsWithHarmanName.forEach(l => console.log(`  user_id=${l.user_id} | ${l.created_at} | ${l.description}`));
  }
}

checkAllHarmanActionsToday();
