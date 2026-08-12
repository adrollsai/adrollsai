require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectHarmanHistoryToday() {
  const harmanId = '7ce0408f-b03f-4af8-a32d-852b6c22da2a';
  
  // Today start & end UTC / IST
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  console.log('Checking lead_history for Harman today:', startOfDay.toISOString(), 'to', endOfDay.toISOString());

  const { data: logs, error } = await supabaseAdmin
    .from('lead_history')
    .select('id, lead_id, user_id, action_type, description, created_at')
    .eq('user_id', harmanId)
    .gte('created_at', startOfDay.toISOString())
    .lte('created_at', endOfDay.toISOString())
    .order('created_at', { ascending: false });

  console.log('Total lead_history logs for Harman today:', logs ? logs.length : 0, error);
  if (logs) {
    console.log('Action types summary:');
    const typeCounts = {};
    logs.forEach(l => {
      typeCounts[l.action_type] = (typeCounts[l.action_type] || 0) + 1;
      console.log(`[${l.created_at}] type=${l.action_type} | desc="${l.description}" | lead_id=${l.lead_id}`);
    });
    console.log('Type counts:', typeCounts);
  }

  // Also check leads assigned to or updated by Harman today
  const { data: leadsUpdatedToday } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, status, pipeline_stage, custom_fields, updated_at')
    .or(`assigned_to.eq.${harmanId},user_id.eq.${harmanId}`)
    .gte('updated_at', startOfDay.toISOString());

  console.log('\nLeads assigned/owned by Harman updated today:', leadsUpdatedToday ? leadsUpdatedToday.length : 0);
}

inspectHarmanHistoryToday();
