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
  const blueSquareId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

  // 1. Exact count of leads in campaign
  const { data: leads, count } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status, voice_call_scheduled_at, voice_call_retry_count, voice_call_summary, created_at', { count: 'exact' })
    .eq('voice_campaign_id', campId);

  console.log(`=== EXACT COUNT IN CAMPAIGN 12d36fab ===: ${count}`);

  const statusBreakdown = {};
  leads?.forEach(l => {
    const s = l.voice_call_status ?? 'null';
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  });
  console.log('Status Breakdown:', statusBreakdown);

  // 2. Profile telephony config
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, business_name, role, credits, voice_provider, voice_twilio_number, voice_twilio_sid, voice_vobiz_number, business_info')
    .eq('id', blueSquareId)
    .single();

  console.log('\n=== PROFILE ===');
  console.log('Business Name:', profile.business_name);
  console.log('Credits:', profile.credits);
  console.log('Voice Provider:', profile.voice_provider);
  console.log('Voice Twilio Number:', profile.voice_twilio_number);
  console.log('Voice Twilio SID:', profile.voice_twilio_sid);
  console.log('Voice Vobiz Number:', profile.voice_vobiz_number);
  console.log('Business Info:', profile.business_info);

  // 3. What happens when dispatchNextCall runs?
  // Let's test dispatchNextCall logic step-by-step
  const now = new Date();
  console.log('\nCurrent Server Time:', now.toISOString(), 'Local:', now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));

  // Check calling hours
  const { computeValidCallingSlot } = require('../utils/voice-helper');
  const slotCheck = computeValidCallingSlot(now, 'Asia/Kolkata', false);
  console.log('Calling hours check right now:', slotCheck);

  // Also check calling hours at the time the campaign was launched: 2026-10-24T09:55:48Z
  const launchedTime = new Date('2026-10-24T09:55:48Z');
  console.log('\nCampaign Launch Time (UTC):', launchedTime.toISOString());
  console.log('Campaign Launch Time (IST):', launchedTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  const launchSlotCheck = computeValidCallingSlot(launchedTime, 'Asia/Kolkata', false);
  console.log('Calling hours check at launch:', launchSlotCheck);

  // 4. Check telephony routing for Blue Square:
  // Does Blue Square have an active phone number or credits?
  const bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : (profile.business_info || {});
  const hasVobiz = !!(profile.voice_vobiz_number || bi.claimed_vobiz_number || bi.voice_vobiz_number);
  const hasTwilio = !!(profile.voice_twilio_number && profile.voice_twilio_sid);
  console.log('\nHas Vobiz number:', hasVobiz, `(profile.voice_vobiz_number=${profile.voice_vobiz_number}, bi.claimed_vobiz_number=${bi.claimed_vobiz_number}, bi.voice_vobiz_number=${bi.voice_vobiz_number})`);
  console.log('Has Twilio number:', hasTwilio, `(voice_twilio_number=${profile.voice_twilio_number}, voice_twilio_sid=${profile.voice_twilio_sid})`);

  // 5. Check if any call was triggered or attempted:
  // Were any leads in this campaign called?
  const called = leads?.filter(l => l.voice_call_status !== 'not_called');
  console.log(`\nLeads in this campaign that are NOT 'not_called': ${called?.length}`);
  called?.forEach(l => {
    console.log(`- ${l.name} (${l.phone}): status=${l.voice_call_status}, summary=${l.voice_call_summary}`);
  });

  // 6. Check cron/voice-caller:
  // Is there a cron job calling dispatchNextCall?
}

main().catch(console.error);
