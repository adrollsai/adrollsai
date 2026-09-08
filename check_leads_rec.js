const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLeadsTable() {
  const { count: withRec } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .not('voice_recording_url', 'is', null);

  console.log(`Leads with non-null voice_recording_url: ${withRec}`);

  // Check leads that have lead_history with CALL_JSON
  const { data: histCalls } = await supabase
    .from('lead_history')
    .select('id, lead_id, description')
    .ilike('description', '%recording_url%')
    .limit(20);

  console.log(`Sample lead_history count with recording_url: ${histCalls?.length || 0}`);
  
  for (const h of histCalls || []) {
    try {
      const jsonStr = h.description.replace('🎙️ CALL_JSON:', '').trim();
      const parsed = JSON.parse(jsonStr);
      console.log(`Lead ID: ${h.lead_id} | Rec URL in history: ${parsed.recording_url || 'NONE'}`);
      
      // Check what leads table has for this lead
      const { data: l } = await supabase
        .from('leads')
        .select('name, phone, voice_recording_url')
        .eq('id', h.lead_id)
        .single();
      console.log(`  leads table voice_recording_url: ${l?.voice_recording_url || 'NULL'}`);
    } catch (e) {
      console.log(`Error parsing: ${e.message}`);
    }
  }
}

checkLeadsTable();
