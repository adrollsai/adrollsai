const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectHistoryAndCallLogs() {
  // 1. Check sample lead_history entries with recording_url
  const { data: histEntries } = await supabase
    .from('lead_history')
    .select('id, lead_id, action, description, created_at')
    .ilike('description', '%recording_url%')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('--- SAMPLE LEAD_HISTORY WITH RECORDING_URL ---');
  for (const h of histEntries || []) {
    console.log(`History ID: ${h.id} | Lead ID: ${h.lead_id} | Created: ${h.created_at}`);
    try {
      const parsed = JSON.parse(h.description.replace('🎙️ CALL_JSON:', '').trim());
      console.log(`  recording_url: ${parsed.recording_url}`);
      console.log(`  duration: ${parsed.duration}`);
      console.log(`  summary: ${parsed.summary?.slice(0, 80)}...`);
    } catch (e) {
      console.log(`  raw description: ${h.description.slice(0, 150)}`);
    }
  }

  // 2. Check sample call_logs entries
  const { data: callLogs } = await supabase
    .from('call_logs')
    .select('id, lead_id, call_sid, recording_url, duration, status, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n--- SAMPLE CALL_LOGS ---');
  for (const c of callLogs || []) {
    console.log(`CallLog ID: ${c.id} | Lead ID: ${c.lead_id} | Duration: ${c.duration}s | Status: ${c.status} | Rec: ${c.recording_url}`);
  }

  // 3. Count call_logs with non-null recording_url
  const { count: callLogsWithRec } = await supabase
    .from('call_logs')
    .select('*', { count: 'exact', head: true })
    .not('recording_url', 'is', null);
  console.log(`\nTotal call_logs with recording_url: ${callLogsWithRec}`);

  // 4. Check how LeadHistoryModal or CRM page displays recordings
  // In leads table, why is voice_recording_url null on the lead itself if lead_history has it?
  const { data: leadsWithHistoryRec } = await supabase
    .from('leads')
    .select('id, name, phone, voice_recording_url')
    .in('id', (histEntries || []).map(h => h.lead_id));
  
  console.log('\n--- Corresponding leads in leads table ---');
  for (const l of leadsWithHistoryRec || []) {
    console.log(`Lead: ${l.name} (${l.phone}) | voice_recording_url: ${l.voice_recording_url}`);
  }
}

inspectHistoryAndCallLogs();
