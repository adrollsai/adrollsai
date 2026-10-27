const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectCampaignProgress() {
  const campId = '12d36fab-1334-4872-9cd1-8a78487f2418';
  
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status, voice_call_scheduled_at, voice_call_summary, voice_call_transcript, voice_recording_url, created_at, custom_fields')
    .eq('voice_campaign_id', campId);

  console.log('Total leads in campaign:', leads?.length);

  const nonNotCalled = leads.filter(l => l.voice_call_status !== 'not_called');
  console.log(`\n=== Non 'not_called' leads (${nonNotCalled.length}) ===`);
  for (const l of nonNotCalled) {
    console.log(`\n-----------------------------------------`);
    console.log(`Lead: ${l.name} | Phone: ${l.phone} | Status: ${l.voice_call_status}`);
    console.log(`Scheduled At: ${l.voice_call_scheduled_at}`);
    console.log(`Recording URL: ${l.voice_recording_url}`);
    console.log(`Summary: ${l.voice_call_summary}`);
    if (l.voice_call_transcript && l.voice_call_transcript.length > 0) {
      console.log(`Transcript:`, JSON.stringify(l.voice_call_transcript));
    }
  }

  // Also check lead_history for these specific leads
  const leadIds = nonNotCalled.map(l => l.id);
  const { data: history } = await supabase
    .from('lead_history')
    .select('*')
    .in('lead_id', leadIds)
    .order('created_at', { ascending: true });

  console.log(`\n=== History entries for these leads (${history?.length}) ===`);
  history?.forEach(h => {
    console.log(`[${h.created_at}] Lead ${h.lead_id} | Type: ${h.action_type} | Desc: ${h.description}`);
  });
}

inspectCampaignProgress().catch(console.error);
