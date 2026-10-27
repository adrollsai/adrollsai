const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('=== DEEP INSPECTION OF CALLS & HISTORY ===');

  // Let's find all lead_history records that mention "Call" or "Calling" or have action_type relating to calls
  const { data: histLogs, error: hErr } = await supabase
    .from('lead_history')
    .select('id, lead_id, action_type, description, created_at, user_id')
    .gte('created_at', '2026-10-23T00:00:00Z')
    .ilike('description', '%call%')
    .order('created_at', { ascending: false });

  console.log(`Lead history mentioning 'call' since Oct 23: ${histLogs?.length || 0}`);
  if (histLogs && histLogs.length > 0) {
    console.log('\n--- Recent 20 call-related history events ---');
    histLogs.slice(0, 20).forEach(h => {
      console.log(`[${h.created_at}] Lead: ${h.lead_id} | Type: ${h.action_type} | User: ${h.user_id} | Desc: ${h.description}`);
    });
  }

  // Let's check leads associated with these history logs
  if (histLogs && histLogs.length > 0) {
    const leadIds = [...new Set(histLogs.map(h => h.lead_id).filter(Boolean))].slice(0, 50);
    const { data: sampleLeads } = await supabase
      .from('leads')
      .select('id, name, phone, user_id, assigned_to, source, voice_call_status, voice_call_scheduled_at, voice_campaign_id')
      .in('id', leadIds);

    console.log(`\nSample leads matching history count: ${sampleLeads?.length || 0}`);
    const leadUserIds = [...new Set(sampleLeads?.map(l => l.user_id))];
    console.log('User IDs of these leads:', leadUserIds);

    // Get profiles for these user IDs
    const { data: leadProfiles } = await supabase
      .from('profiles')
      .select('id, email, business_name, role')
      .in('id', leadUserIds);
    console.log('Profiles of these leads:', leadProfiles);
  }

  // Also check if any leads have voice_call_scheduled_at set for today or yesterday
  const { data: scheduledLeads, count: scCount } = await supabase
    .from('leads')
    .select('id, name, phone, user_id, assigned_to, voice_call_status, voice_call_scheduled_at, voice_campaign_id, created_at', { count: 'exact' })
    .not('voice_call_scheduled_at', 'is', null)
    .order('voice_call_scheduled_at', { ascending: false });

  console.log(`\nTotal leads with voice_call_scheduled_at: ${scCount}`);
  if (scheduledLeads && scheduledLeads.length > 0) {
    console.log('First 10 scheduled leads:');
    scheduledLeads.slice(0, 10).forEach(l => {
      console.log(`- ${l.name} (${l.phone}): status=${l.voice_call_status}, scheduled_at=${l.voice_call_scheduled_at}, user=${l.user_id}`);
    });
  }
}

main().catch(console.error);
