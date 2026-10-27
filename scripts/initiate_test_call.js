const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BIOQUE_USER_ID = '68b55a31-a16d-454d-a20f-11adabf590b0';
const BIOQUE_CALLER_NUMBER = '+917965480539';
const AMRITHAVANA_CAMPAIGN_ID = '8e12bad9-7201-43c0-8d08-1d991a28e156';

async function initiateCall() {
  const prospectPhone = '+918288835235';
  const prospectName = 'Rahul';

  console.log(`[CALL] Initiating call to ${prospectPhone} (${prospectName})...`);

  // Create lead record
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .insert({
      user_id: BIOQUE_USER_ID,
      name: prospectName,
      phone: prospectPhone,
      source: 'AI Call Demo',
      pipeline_stage: 'New Lead',
      status: 'New Lead',
      voice_campaign_id: AMRITHAVANA_CAMPAIGN_ID,
      voice_call_status: 'calling',
      notes: `[🎙️ Voice Stability Test Call]\nBusiness: Raj Abhijna Property Developers, Mysuru\nVoice: Aoede (Female Indian English)\nTest: Post voice-modulation fix verification`,
      custom_fields: {
        is_demo_call: true,
        is_test_call: true,
        skip_credit_deduction: true,
        allow_after_hours: true,
        demo_business_name: 'Raj Abhijna Property Developers, Mysuru',
        demo_voice_name: 'Aoede',
        'primary_interest': 'Luxury Weekend Farmhouse with Dome',
        'preferred_configuration_and_budget': '₹50 Lakhs (6,000 Sq.Ft Plot + Dome Launch Offer)',
        'site_visit_timeline': 'This Coming Weekend',
        meta_ad_origin: {
          campaign_name: 'Amritha Vana Mysore - Luxury Farm Retreats',
          product_name: 'Amritha Vana Luxury Farm Plot + Dome (₹50L Launch Offer)',
          ad_name: 'Ad 1 - Luxury Glamping & Dome Retreat'
        }
      }
    })
    .select()
    .single();

  if (leadErr || !lead) {
    console.error('Failed to create lead:', leadErr);
    return;
  }

  console.log(`[CALL] Lead created: ${lead.id}`);

  // Prewarm voice bridge
  const bridgeUrl = 'https://gemini-voice-bridge-805895515412.us-central1.run.app';
  try {
    const prewarmRes = await fetch(`${bridgeUrl}/prewarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: lead.id,
        profileId: BIOQUE_USER_ID,
        campaignId: AMRITHAVANA_CAMPAIGN_ID,
        voiceName: 'Aoede'
      })
    });
    const prewarmData = await prewarmRes.json();
    console.log(`[CALL] Prewarm response:`, prewarmData);
  } catch (e) {
    console.warn('[CALL] Prewarm warning:', e.message);
  }

  // Trigger Vobiz outbound call
  const vobizAuthId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
  const vobizAuthToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
  const answerUrl = `${bridgeUrl}/vobiz-xml?leadId=${lead.id}&profileId=${BIOQUE_USER_ID}&campaignId=${AMRITHAVANA_CAMPAIGN_ID}&voiceName=Aoede`;

  console.log(`[CALL] Triggering Vobiz outbound call...`);
  console.log(`[CALL] Answer URL: ${answerUrl}`);

  const callRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${vobizAuthId}/Call/`, {
    method: 'POST',
    headers: {
      'X-Auth-ID': vobizAuthId,
      'X-Auth-Token': vobizAuthToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: BIOQUE_CALLER_NUMBER,
      to: prospectPhone,
      answer_url: answerUrl,
      answer_method: 'POST',
      hangup_url: `${bridgeUrl}/vobiz-status?leadId=${lead.id}`,
      hangup_method: 'POST',
      ring_timeout: 45
    })
  });

  const callData = await callRes.json();
  console.log(`[CALL] Vobiz response:`, JSON.stringify(callData));

  if (callData.request_uuid || callData.RequestUUID || callData.call_uuid) {
    const callUuid = callData.request_uuid || callData.RequestUUID || callData.call_uuid;
    console.log(`✅ Call initiated successfully! UUID: ${callUuid}`);
    console.log(`📞 Calling ${prospectPhone} from ${BIOQUE_CALLER_NUMBER}`);
    
    // Auto-trigger recording on Vobiz REST API
    try {
      fetch(`https://api.vobiz.ai/api/v1/Account/${vobizAuthId}/Call/${callUuid}/Record/`, {
        method: 'POST',
        headers: {
          'X-Auth-ID': vobizAuthId,
          'X-Auth-Token': vobizAuthToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file_format: 'mp3',
          time_limit: 600,
          callback_url: `${bridgeUrl}/vobiz-status?leadId=${lead.id}&event=recording`
        })
      }).then(r => r.json()).then(d => console.log('[CALL] Vobiz Record trigger response:', d)).catch(e => console.warn('[CALL] Record trigger error:', e.message));
    } catch (rErr) {
      console.warn('[CALL] Error launching recording trigger:', rErr.message);
    }

    await supabase
      .from('leads')
      .update({ voice_call_status: 'calling' })
      .eq('id', lead.id);
  } else {
    console.error('❌ Call failed:', callData);
    await supabase
      .from('leads')
      .update({ voice_call_status: 'failed' })
      .eq('id', lead.id);
  }
}

initiateCall().catch(console.error);
