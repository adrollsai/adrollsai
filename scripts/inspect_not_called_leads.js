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

  // 1. Total leads for Bluesquare with voice_call_status
  const { count: notCalledCount } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', blueSquareId)
    .eq('voice_call_status', 'not_called');

  console.log(`Leads with voice_call_status = 'not_called': ${notCalledCount}`);

  const { count: callingCount } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', blueSquareId)
    .eq('voice_call_status', 'calling');
  console.log(`Leads with voice_call_status = 'calling': ${callingCount}`);

  const { count: completedCount } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', blueSquareId)
    .eq('voice_call_status', 'completed');
  console.log(`Leads with voice_call_status = 'completed': ${completedCount}`);

  const { count: failedCount } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', blueSquareId)
    .in('voice_call_status', ['failed', 'failed_max_retries']);
  console.log(`Leads with voice_call_status = 'failed': ${failedCount}`);

  // Fetch some leads that have not_called or have voice_campaign_id
  const { data: sampleNotCalled } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status, voice_campaign_id, voice_call_scheduled_at, voice_call_retry_count, custom_fields, created_at')
    .eq('user_id', blueSquareId)
    .eq('voice_call_status', 'not_called')
    .limit(20);

  console.log('\nSample not_called leads:');
  sampleNotCalled?.forEach(l => {
    console.log(`ID: ${l.id} | Name: ${l.name} | Phone: ${l.phone} | CampaignId: ${l.voice_campaign_id} | Retry: ${l.voice_call_retry_count} | Sched: ${l.voice_call_scheduled_at}`);
  });

  // Check unique voice_campaign_ids among not_called leads
  const { data: allNotCalledCamps } = await supabase
    .from('leads')
    .select('voice_campaign_id')
    .eq('user_id', blueSquareId)
    .eq('voice_call_status', 'not_called');

  const campIdCounts = {};
  allNotCalledCamps?.forEach(l => {
    const cid = l.voice_campaign_id || 'null';
    campIdCounts[cid] = (campIdCounts[cid] || 0) + 1;
  });
  console.log('\nvoice_campaign_id distribution among not_called leads:', campIdCounts);

  // If there are campaign IDs, let's query voice_campaigns table for them
  const campIds = Object.keys(campIdCounts).filter(k => k !== 'null');
  if (campIds.length > 0) {
    const { data: camps } = await supabase
      .from('voice_campaigns')
      .select('*')
      .in('id', campIds);
    console.log('\nVoice campaigns matching these IDs:', camps);
  }

  // 2. Check Bluesquare profile voice settings
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, voice_twilio_number, voice_twilio_sid, voice_vobiz_number, voice_provider, business_info')
    .eq('id', blueSquareId)
    .single();

  console.log('\nBluesquare Telephony Configuration:');
  console.log('voice_twilio_number:', profile.voice_twilio_number);
  console.log('voice_twilio_sid:', profile.voice_twilio_sid);
  console.log('voice_vobiz_number:', profile.voice_vobiz_number);
  console.log('voice_provider:', profile.voice_provider);
  console.log('business_info:', JSON.stringify(profile.business_info));

  // 3. What happens when dispatchNextCall is called for Bluesquare?
  // Let's check Vobiz CDR or Twilio logs if any
}

main().catch(console.error);
