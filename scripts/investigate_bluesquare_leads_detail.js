const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const blueSquareId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

  // 1. Check ALL voice_campaigns for this user or any campaigns created recently
  const { data: allCamps, error: cErr } = await supabase
    .from('voice_campaigns')
    .select('*')
    .eq('user_id', blueSquareId);
  console.log('Voice campaigns for Bluesquare:', allCamps);

  // Check the specific campaign ID '12d36fab-1334-4872-9cd1-8a78487f2418'
  const { data: specificCamp } = await supabase
    .from('voice_campaigns')
    .select('*')
    .eq('id', '12d36fab-1334-4872-9cd1-8a78487f2418');
  console.log('Specific campaign 12d36fab:', specificCamp);

  // Check any campaign created in October 2026 across ALL users
  const { data: octCamps } = await supabase
    .from('voice_campaigns')
    .select('*')
    .gte('created_at', '2026-10-20T00:00:00Z');
  console.log('Campaigns created since Oct 20 across all users:', octCamps);

  // 2. Check profile details for Bluesquare: voice provider, phone number, credits, etc.
  const { data: bsProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', blueSquareId)
    .single();
  console.log('\n=== BLUESQUARE PROFILE DETAILS ===');
  console.log('Email:', bsProfile.email);
  console.log('Business Name:', bsProfile.business_name);
  console.log('Voice Twilio Number:', bsProfile.voice_twilio_number);
  console.log('Voice Twilio SID:', bsProfile.voice_twilio_sid);
  console.log('Voice Vobiz Number:', bsProfile.voice_vobiz_number);
  console.log('Voice Provider:', bsProfile.voice_provider);
  console.log('Business Info:', bsProfile.business_info);
  console.log('Credits / Billing:', bsProfile.credits, bsProfile.billing_plan);

  // 3. Check credits in credit_wallets / nobo credits
  const { data: wallet } = await supabase
    .from('credit_wallets')
    .select('*')
    .eq('user_id', blueSquareId);
  console.log('Credit wallet:', wallet);

  // 4. How many leads does Bluesquare have? Check sources, creation dates, voice_call_status
  const { data: leads, count } = await supabase
    .from('leads')
    .select('id, name, phone, source, pipeline_stage, voice_call_status, voice_call_scheduled_at, voice_campaign_id, voice_call_summary, created_at, custom_fields', { count: 'exact' })
    .eq('user_id', blueSquareId);

  console.log(`\nTotal leads for Bluesquare: ${count}`);

  // Count by voice_call_status
  const statusMap = {};
  leads?.forEach(l => {
    const s = l.voice_call_status ?? 'null';
    statusMap[s] = (statusMap[s] || 0) + 1;
  });
  console.log('voice_call_status breakdown:', statusMap);

  // Count by source
  const sourceMap = {};
  leads?.forEach(l => {
    const s = l.source ?? 'null';
    sourceMap[s] = (sourceMap[s] || 0) + 1;
  });
  console.log('source breakdown:', sourceMap);

  // Check leads with any voice_call_summary or transcript
  const withSummary = leads?.filter(l => l.voice_call_summary);
  console.log(`Leads with voice_call_summary: ${withSummary?.length}`);
  if (withSummary?.length > 0) {
    withSummary.slice(0, 5).forEach(l => {
      console.log(`- ${l.name} (${l.phone}): ${l.voice_call_summary}`);
    });
  }

  // Check leads with scheduled callback or retry
  const scheduled = leads?.filter(l => l.voice_call_scheduled_at);
  console.log(`Leads with voice_call_scheduled_at: ${scheduled?.length}`);
  scheduled?.forEach(l => {
    console.log(`- ${l.name} (${l.phone}): status=${l.voice_call_status}, scheduled=${l.voice_call_scheduled_at}`);
  });

  // 5. Look for recent lead_history on Bluesquare leads
  const { data: bsHistory } = await supabase
    .from('lead_history')
    .select('*')
    .in('lead_id', leads?.slice(0, 100).map(l => l.id) || [])
    .order('created_at', { ascending: false })
    .limit(20);
  console.log('\nSample history on Bluesquare leads:');
  bsHistory?.forEach(h => {
    console.log(`[${h.created_at}] Lead ${h.lead_id} (${h.action_type}): ${h.description}`);
  });

  // 6. Check call_logs or voice_call_logs or vobiz_logs
  // Check what tables might exist related to voice
  const voiceTables = ['call_logs', 'voice_logs', 'vobiz_calls', 'calls', 'voice_campaign_logs', 'broadcasts'];
  for (const t of voiceTables) {
    try {
      const { data, count } = await supabase.from(t).select('*', { count: 'exact', head: true });
      console.log(`Table ${t}: exists, count = ${count}`);
    } catch (e) {
      console.log(`Table ${t}: does not exist or error`);
    }
  }
}

main().catch(console.error);
