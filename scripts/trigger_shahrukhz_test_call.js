const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const { triggerOutboundCall } = require('../utils/voice-helper');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runTestCall() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0'; // Bioque Estates
  const targetPhone = '+918288835235';
  const voiceCampaignId = 'bee2bf56-cd5b-4646-8120-a3498f4acf95'; // Shahrukhz Residences
  const metaCampaignId = '120251924470700304';
  const propertyId = 'b8007315-e951-4005-9ced-8aa9f190a231'; // Shahrukhz property in catalogue

  console.log(`[TEST CALL] Triggering test call for Shahrukhz Residences to ${targetPhone}...`);

  // Ensure test lead is in fresh state
  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .ilike('phone', '%8288835235%')
    .maybeSingle();

  if (!lead) {
    console.error('Lead not found. Please run scripts/test_shahrukhz_setup_config.js first.');
    return;
  }

  // Reset status to allow immediate call
  await supabaseAdmin
    .from('leads')
    .update({
      voice_call_status: null,
      voice_call_scheduled_at: null,
      voice_call_retry_count: 0
    })
    .eq('id', lead.id);

  console.log(`[TEST CALL] Dialing lead ${lead.id} (${lead.name}) via Vobiz...`);
  const result = await triggerOutboundCall(
    supabaseAdmin,
    lead.id,
    userId,
    false,
    voiceCampaignId
  );

  console.log('[TEST CALL] Call result:', result);
  return result;
}

runTestCall().catch(console.error);
