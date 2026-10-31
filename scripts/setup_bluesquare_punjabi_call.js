const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BLUE_SQUARE_PROFILE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
const LEAD_ID = 'be30b0f0-f64f-4170-a031-b19226bee31b';
const DEST_PHONE = '+918288835235';
const VOICE_NAME = 'Charon'; // Calm, measured, steady male voice

async function setupAndTriggerCall() {
  console.log('================================================================');
  console.log(`🚀 TRIGGERING CALM MALE PUNJABI CALL (${VOICE_NAME})`);
  console.log('================================================================');

  // 1. Fetch Profile
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', BLUE_SQUARE_PROFILE_ID)
    .single();

  if (pErr || !profile) {
    throw new Error('Profile fetch failed: ' + pErr?.message);
  }

  const bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : (profile.business_info || {});
  const authId = bi.voice_vobiz_auth_id || profile.voice_vobiz_auth_id || 'SA_RUY0ZNCH';
  const authToken = bi.voice_vobiz_auth_token || profile.voice_vobiz_auth_token || 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi';
  const callerNumber = bi.claimed_vobiz_number || profile.voice_twilio_number || '+917965480905';

  console.log('🏢 Profile:', profile.business_name);
  console.log('📞 Caller DID:', callerNumber);
  console.log('🔑 Vobiz Auth ID:', authId);

  // 2. Setup Calm Male Punjabi Campaign
  const customPrompt = `ROLE & OBJECTIVE:
You are calling on behalf of "Blue Square Infra" (Riverdale Business Center, SCO-3, Zirakpur).
You are a calm, grounded, courteous MALE property advisor named Gurpreet.
You are speaking directly with Rahul ji over the phone.

GREETING: "Sat Sri Akal ji! Main Blue Square Infra ton Gurpreet bol reha haan. Tuhadi Facebook ad dekhi si — ki meri Rahul ji naal gall ho rahi aa?"

VOICE, CADENCE & TONE MANDATE (CRITICAL - CALM & STEADY):
- TONE & DELIVERY: Speak in a CALM, RELAXED, NORMAL, and UNHURRIED conversational tone.
- STRICT PROHIBITION: NEVER sound hyperactive, overly cheerful, rushed, or upbeat like a radio jockey. Speak like a mature, calm professional.
- GENDER IDENTITY: You are Gurpreet, a MALE advisor. Use natural masculine Punjabi grammar ("bol reha haan", "dass reha haan", "puchh reha haan").
- MANDATORY LANGUAGE: Natural, everyday, polite PUNJABI (ਪੰਜਾਬੀ).
- NATURAL COLLOQUIAL CADENCE:
  * Use calm conversational particles: "Haan ji", "Acha ji", "Ji bilkul", "Sahi gal hai ji", "Dasso ji".
  * Keep each turn short (1 to 2 sentences, under 15-20 words).
  * Pause and wait calmly for Rahul to speak.
- CONVERSATIONAL STAGES:
  * STEP 1 (GREETING): Deliver the calm opening greeting and wait for confirmation.
  * STEP 2 (DISCOVERY): "Vadiya ji. Tussi Zirakpur vich plot ya flat dekh rahe ho, ya investment layi plan kar rahe ho ji?"
  * STEP 3 (LOCATION): "Sahi gal hai ji. Airport Road kol dekh rahe ho ya Nabha side?"
  * STEP 4 (NEXT STEP): "Boht vadiya ji. Ki main saade senior consultant naal tuhadi kal site visit plan karwa deyaan ji?"
  * FAREWELL: "Dhanwaad Rahul ji, tuhada din shubh rahe!" and trigger 'end_call'.`;

  let { data: camp } = await supabase
    .from('voice_campaigns')
    .select('*')
    .eq('user_id', BLUE_SQUARE_PROFILE_ID)
    .ilike('name', '%Punjabi%')
    .maybeSingle();

  if (!camp) {
    const { data: newCamp, error: cErr } = await supabase
      .from('voice_campaigns')
      .insert({
        user_id: BLUE_SQUARE_PROFILE_ID,
        name: 'Blue Square Infra - Punjabi Property Advisory',
        status: 'active',
        custom_prompt: customPrompt,
        audience_filter: {
          language: 'punjabi',
          voice_name: VOICE_NAME,
          greeting: 'Sat Sri Akal ji! Main Blue Square Infra ton Gurpreet bol reha haan. Tuhadi Facebook ad dekhi si — ki meri Rahul ji naal gall ho rahi aa?'
        }
      })
      .select()
      .single();
    if (cErr) throw cErr;
    camp = newCamp;
  } else {
    const { data: updatedCamp, error: uErr } = await supabase
      .from('voice_campaigns')
      .update({
        custom_prompt: customPrompt,
        status: 'active',
        audience_filter: {
          language: 'punjabi',
          voice_name: VOICE_NAME,
          greeting: 'Sat Sri Akal ji! Main Blue Square Infra ton Gurpreet bol reha haan. Tuhadi Facebook ad dekhi si — ki meri Rahul ji naal gall ho rahi aa?'
        }
      })
      .eq('id', camp.id)
      .select()
      .single();
    if (uErr) throw uErr;
    camp = updatedCamp;
  }
  console.log(`✅ Updated Campaign with Calm Male Voice (${VOICE_NAME}):`, camp.id);

  // 3. Update Lead
  const customFields = {
    is_demo_call: true,
    is_test_call: true,
    allow_after_hours: true,
    skip_credit_deduction: true,
    demo_business_name: 'Blue Square Infra, Zirakpur',
    primary_interest: 'Luxury Residential Plots & 3BHK Flats in Zirakpur',
    preferred_budget: '₹1 Cr - ₹1.5 Cr',
    meta_ad_origin: {
      campaign_name: 'Blue Square Infra - Luxury Residential Plots',
      ad_name: 'Riverdale Business Center SCO-3 Zirakpur'
    }
  };

  const { data: lead, error: lErr } = await supabase
    .from('leads')
    .update({
      name: 'Rahul',
      phone: DEST_PHONE,
      voice_campaign_id: camp.id,
      voice_call_status: 'ready',
      calling_enabled: true,
      custom_fields: customFields
    })
    .eq('id', LEAD_ID)
    .select()
    .single();

  if (lErr) throw lErr;
  console.log('✅ Lead updated for calm male call:', lead.id);

  // 4. Prewarm session on Cloud Run Voice Bridge with Charon
  const bridgeUrl = 'https://gemini-voice-bridge-805895515412.us-central1.run.app';
  console.log(`⚡ Pre-warming Gemini voice session on Cloud Run with ${VOICE_NAME}...`);
  try {
    const pwRes = await fetch(`${bridgeUrl}/prewarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: lead.id,
        profileId: BLUE_SQUARE_PROFILE_ID,
        campaignId: camp.id,
        voiceName: VOICE_NAME
      })
    });
    const pwData = await pwRes.json().catch(() => ({}));
    console.log('⚡ Pre-warm response:', pwData);
  } catch (pwErr) {
    console.warn('⚡ Pre-warm warning:', pwErr.message);
  }

  // 5. Dial Outbound Call via Vobiz API
  const answerUrl = `${bridgeUrl}/vobiz-xml?leadId=${lead.id}&profileId=${BLUE_SQUARE_PROFILE_ID}&campaignId=${camp.id}&voiceName=${VOICE_NAME}`;
  const hangupUrl = `${bridgeUrl}/vobiz-status?leadId=${lead.id}`;

  const requestPayload = {
    from: callerNumber,
    to: DEST_PHONE,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST',
    ring_timeout: 45
  };

  console.log('\n📞 Dialing outbound via Vobiz REST API:');
  console.log(JSON.stringify(requestPayload, null, 2));

  const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;
  const callRes = await fetch(vobizUrl, {
    method: 'POST',
    headers: {
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestPayload)
  });

  const callData = await callRes.json().catch(() => ({}));
  console.log('Vobiz HTTP Status:', callRes.status);
  console.log('Vobiz Response:', JSON.stringify(callData, null, 2));

  const callUuid = callData.request_uuid || callData.RequestUUID || callData.call_uuid;
  if (callUuid) {
    console.log(`\n🎉 Call successfully initiated! Call UUID: ${callUuid}`);
    console.log(`>>> Your phone (${DEST_PHONE}) is ringing right now with calm male voice (${VOICE_NAME})! <<<`);

    await supabase
      .from('leads')
      .update({ voice_call_status: 'calling' })
      .eq('id', lead.id);
  } else {
    console.error('❌ Failed to initiate call:', callData);
  }
}

setupAndTriggerCall().catch(console.error);
