const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runTestCall() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0'; // Bioque Estates International
  const targetPhone = '+918288835235';
  const voiceCampaignId = 'bee2bf56-cd5b-4646-8120-a3498f4acf95'; // Shahrukhz Residences
  const metaCampaignId = '120251924470700304';
  const propertyId = 'b8007315-e951-4005-9ced-8aa9f190a231'; // Shahrukhz property in catalogue

  console.log(`[TEST CALL] Preparing Shahrukhz Residences test call to ${targetPhone}...`);

  // 1. Fetch Profile Credentials
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  const bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : (profile.business_info || {});
  const authId = bi.voice_vobiz_auth_id || profile.voice_vobiz_auth_id || process.env.VOBIZ_AUTH_ID;
  const authToken = bi.voice_vobiz_auth_token || profile.voice_vobiz_auth_token || process.env.VOBIZ_AUTH_TOKEN;
  const fromPhone = bi.claimed_vobiz_number || profile.voice_vobiz_number || profile.voice_twilio_number || '+917965480539';

  console.log('[TEST CALL] Caller credentials:', { authId, fromPhone, businessName: profile.business_name });

  // 2. Fetch or create test lead
  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .ilike('phone', '%8288835235%')
    .maybeSingle();

  const formAnswers = {
    meta_ad_origin: {
      campaign_id: metaCampaignId,
      campaign_name: 'Shahrukhz Residences | Danube Maritime City | 19-10-2026',
      product_name: 'SHAHRUKHZ RESIDENCES BY DANUBE',
      form_id: '1885013402872435',
      form_name: 'Shahrukhz Residences Danube | Higher Intent Qualifying Form | 19-10-2026',
      headline: '👑 Live Life King Style at Shahrukhz Residences by Danube'
    },
    planned_budget: 'AED 3M - AED 5M (~₹6.8 Cr - ₹11.4 Cr) [2 BHK]',
    preferred_configuration: '2 BHK Waterfront Residence (From AED 4.25M)',
    booking_timeline: 'Immediate Priority EOI (AED 50K - 100K)',
    investment_goal: 'Iconic Waterfront Living & Yacht Lifestyle',
    funding_readiness: '10% Down Payment Ready + 30:70 Payment Plan',
    city: 'Chandigarh',
    is_instant_form: true,
    qualification_completed: true
  };

  if (!lead) {
    const { data: newLead } = await supabaseAdmin
      .from('leads')
      .insert({
        user_id: userId,
        name: 'Raman',
        phone: targetPhone,
        source: 'Facebook Ads',
        campaign_id: metaCampaignId,
        form_id: '1885013402872435',
        voice_campaign_id: voiceCampaignId,
        property_id: propertyId,
        custom_fields: formAnswers,
        pipeline_stage: 'New Lead',
        status: 'New Lead'
      })
      .select()
      .single();
    lead = newLead;
  } else {
    const { data: updatedLead } = await supabaseAdmin
      .from('leads')
      .update({
        name: lead.name || 'Raman',
        source: 'Facebook Ads',
        campaign_id: metaCampaignId,
        form_id: '1885013402872435',
        voice_campaign_id: voiceCampaignId,
        property_id: propertyId,
        custom_fields: formAnswers,
        voice_call_status: 'calling',
        voice_call_scheduled_at: new Date().toISOString(),
        voice_call_retry_count: 0
      })
      .eq('id', lead.id)
      .select()
      .single();
    lead = updatedLead;
  }

  // 3. Pre-warm Gemini session
  const bridgeUrl = 'https://gemini-voice-bridge-805895515412.us-central1.run.app';
  try {
    console.log('[TEST CALL] Pre-warming voice bridge session...');
    await fetch(`${bridgeUrl}/prewarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: lead.id,
        profileId: userId,
        campaignId: voiceCampaignId,
        voiceName: 'Aoede'
      })
    });
  } catch (pwErr) {
    console.warn('[TEST CALL] Prewarm warning:', pwErr.message);
  }

  // 4. Dial outbound via Vobiz API
  const appUrl = 'https://app.nobogent.com';
  const answerUrl = `${appUrl}/api/voice/vobiz/xml?leadId=${lead.id}&profileId=${userId}&campaignId=${voiceCampaignId}&voiceName=Aoede`;
  const hangupUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${lead.id}`;

  const requestPayload = {
    from: fromPhone,
    to: targetPhone,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST'
  };

  console.log('\n[TEST CALL] Dialing Vobiz API with payload:', requestPayload);

  const vobizEndpoint = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;
  const res = await fetch(vobizEndpoint, {
    method: 'POST',
    headers: {
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestPayload)
  });

  const rawRes = await res.text();
  console.log(`[TEST CALL] Vobiz Response (${res.status}):`, rawRes);

  let parsed = null;
  try { parsed = JSON.parse(rawRes); } catch (e) {}

  if (res.ok && parsed && (parsed.call_uuid || parsed.message === 'call initiated' || parsed.success !== false)) {
    console.log('✅ TEST CALL SUCCESSFULLY DIALED TO:', targetPhone);
    console.log('Call UUID:', parsed.call_uuid);
    return { success: true, callUuid: parsed.call_uuid };
  } else {
    console.error('❌ Call initiation failed:', rawRes);
    return { success: false, error: rawRes };
  }
}

runTestCall().catch(console.error);
