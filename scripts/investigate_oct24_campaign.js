const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const campId = '12d36fab-1334-4872-9cd1-8a78487f2418';
  
  // 1. Get campaign
  const { data: camp } = await supabase
    .from('voice_campaigns')
    .select('*')
    .eq('id', campId)
    .single();

  console.log('Campaign details:', camp);

  // 2. Get profile of camp.user_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', camp.user_id)
    .single();

  console.log('\n=== PROFILE OF CAMPAIGN USER ===');
  console.log('ID:', profile?.id);
  console.log('Email:', profile?.email);
  console.log('Business Name:', profile?.business_name);
  console.log('Role:', profile?.role);
  console.log('Credits:', profile?.credits);
  console.log('Voice Provider:', profile?.voice_provider);
  console.log('Voice Twilio Number:', profile?.voice_twilio_number);
  console.log('Voice Twilio SID:', profile?.voice_twilio_sid);
  console.log('Voice Vobiz Number:', profile?.voice_vobiz_number);
  console.log('Business Info:', JSON.stringify(profile?.business_info, null, 2));

  // 3. Count leads linked to this campaign
  const { data: campLeads, count: campLeadsCount } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status, voice_call_scheduled_at, voice_call_summary, voice_call_transcript, voice_recording_url, created_at, custom_fields', { count: 'exact' })
    .eq('voice_campaign_id', campId);

  console.log(`\nTotal leads currently linked to campaign ${campId}: ${campLeadsCount}`);
  campLeads?.forEach(l => {
    console.log(`- ${l.name} (${l.phone}): status=${l.voice_call_status}, sched=${l.voice_call_scheduled_at}, summary=${l.voice_call_summary}`);
  });

  // 4. Check lead_history for any history entries around 2026-10-24 09:55:00 UTC to 2026-10-24 23:59:59 UTC
  const { data: historyEntries } = await supabase
    .from('lead_history')
    .select('*')
    .gte('created_at', '2026-10-24T09:50:00Z')
    .lte('created_at', '2026-10-24T12:00:00Z')
    .order('created_at', { ascending: true });

  console.log(`\nLead history entries between 09:50Z and 12:00Z on 2026-10-24: ${historyEntries?.length}`);
  historyEntries?.forEach(h => {
    console.log(`[${h.created_at}] Lead: ${h.lead_id} | User: ${h.user_id} | Type: ${h.action_type} | Desc: ${h.description}`);
  });

  // 5. Were any other voice campaigns created around that time?
  const { data: otherCamps } = await supabase
    .from('voice_campaigns')
    .select('*')
    .gte('created_at', '2026-10-24T00:00:00Z')
    .lte('created_at', '2026-10-25T00:00:00Z');

  console.log(`\nAll voice campaigns created on 2026-10-24: ${otherCamps?.length}`);
  otherCamps?.forEach(c => {
    console.log(`- [${c.created_at}] ID: ${c.id} | Name: ${c.name} | User: ${c.user_id} | Status: ${c.status}`);
  });
}

main().catch(console.error);
