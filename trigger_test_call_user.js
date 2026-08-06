const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { triggerOutboundCall } = require('./utils/voice-helper');

async function testCall() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram account
  const campaignId = '65085d5d-2d7d-461b-a682-bdd0adb95b16'; // Active Farmhouse campaign with greeting & custom prompt

  const userPhone = '+918288835235';

  // 1. Check if lead exists or create test lead
  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .ilike('phone', '%8288835235%')
    .maybeSingle();

  if (!lead) {
    console.log("Creating test lead for phone +918288835235...");
    const { data: newLead, error: createErr } = await supabaseAdmin
      .from('leads')
      .insert({
        user_id: userId,
        name: 'Raman',
        phone: userPhone,
        source: 'Test Call',
        voice_campaign_id: campaignId,
        voice_call_status: null
      })
      .select()
      .single();

    if (createErr) {
      console.error("Error creating test lead:", createErr);
      return;
    }
    lead = newLead;
  } else {
    console.log(`Found existing lead ID: ${lead.id}, updating campaignId and resetting status...`);
    await supabaseAdmin
      .from('leads')
      .update({
        voice_campaign_id: campaignId,
        voice_call_status: null,
        voice_call_retry_count: 0
      })
      .eq('id', lead.id);
  }

  console.log(`\nTriggering AI Voice Test Call to ${userPhone} (Lead: ${lead.name}, Campaign ID: ${campaignId})...`);
  const result = await triggerOutboundCall(supabaseAdmin, lead.id, userId, false, campaignId);
  console.log("Outbound Call Result:\n", result);
}

testCall();
