const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspect() {
  const userId = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde';

  // 1. Credit transactions
  const { data: txs } = await supabaseAdmin
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  console.log('Credit Transactions count:', txs?.length);
  txs?.forEach(t => console.log('Tx:', t.created_at, t.category, t.amount, t.description));

  // 2. Profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('credits, business_name, email')
    .eq('id', userId)
    .single();
  console.log('\nProfile credits:', profile);

  // 3. Leads
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, voice_call_status, voice_call_id, voice_recording_url, voice_call_summary, voice_call_transcript, booked_time, pipeline_stage, status, created_at, custom_fields, voice_call_scheduled_at, voice_call_retry_count')
    .eq('user_id', userId);

  console.log('\nTotal leads for Umang:', leads?.length);

  const byStatus = {};
  leads?.forEach(l => {
    const s = l.voice_call_status || 'NOT_CALLED';
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push(l);
  });

  console.log('\n--- BREAKDOWN BY voice_call_status ---');
  for (const [st, list] of Object.entries(byStatus)) {
    console.log(`Status "${st}": ${list.length}`);
  }

  // Check leads with completed calls
  console.log('\n--- COMPLETED CALLS ---');
  const completed = byStatus['completed'] || [];
  completed.forEach((l, idx) => {
    const hasRecording = !!l.voice_recording_url;
    const hasTranscript = !!(l.voice_call_transcript && l.voice_call_transcript.length);
    console.log(`${idx + 1}. ${l.name} | ${l.phone} | Booked: ${l.booked_time || 'None'} | Stage: ${l.pipeline_stage} | Recording: ${hasRecording} | Transcript turns: ${l.voice_call_transcript?.length || 0}`);
    if (l.booked_time) {
      console.log(`   -> BOOKING TIME: ${l.booked_time}`);
    }
  });

  // Check leads with calling or other statuses
  for (const st of ['no_answer', 'calling', 'skipped_international', 'failed']) {
    if (byStatus[st]) {
      console.log(`\n--- Status "${st}" (${byStatus[st].length}) ---`);
      byStatus[st].forEach((l, idx) => {
        console.log(`${idx + 1}. ${l.name} | ${l.phone} | Retries: ${l.voice_call_retry_count} | Sched: ${l.voice_call_scheduled_at}`);
      });
    }
  }

  // Check if any other lead has booked_time or booking mentioned
  console.log('\n--- CHECKING ALL LEADS FOR BOOKINGS / APPOINTMENTS ---');
  const allBookings = leads?.filter(l => {
    const cfStr = typeof l.custom_fields === 'string' ? l.custom_fields : JSON.stringify(l.custom_fields || {});
    return l.booked_time || 
           l.pipeline_stage?.toLowerCase().includes('appoint') || 
           l.pipeline_stage?.toLowerCase().includes('visit') || 
           l.pipeline_stage?.toLowerCase().includes('book') ||
           l.status?.toLowerCase().includes('appoint') ||
           l.status?.toLowerCase().includes('book') ||
           cfStr.toLowerCase().includes('appointment_booked":1') ||
           cfStr.toLowerCase().includes('appointment');
  });

  console.log(`Found ${allBookings?.length} leads with booking/visit mentions:`);
  allBookings?.forEach((l, idx) => {
    console.log(`${idx + 1}. ${l.name} (${l.phone}): booked_time=${l.booked_time}, stage=${l.pipeline_stage}, status=${l.status}, call_status=${l.voice_call_status}`);
    if (l.voice_call_summary) {
      console.log(`   Summary: ${l.voice_call_summary}`);
    }
  });
}

inspect().catch(console.error);
