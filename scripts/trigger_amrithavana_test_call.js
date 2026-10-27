const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runTestCall() {
  const userId = 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f'; // RAJ ABHIJNA PROPERTY DEVELOPERS PVT LTD
  const targetPhone = '+918288835235';
  const voiceCampaignId = '8e12bad9-7201-43c0-8d08-1d991a28e156'; // Amrithavana Farm Project

  console.log(`[TEST CALL] Preparing Amrithavana Farm Project test call to ${targetPhone}...`);

  // 1. Fetch Profile Credentials
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (pErr || !profile) {
    throw new Error('Profile fetch failed: ' + pErr?.message);
  }

  const bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : (profile.business_info || {});
  const authId = bi.voice_vobiz_auth_id || profile.voice_vobiz_auth_id || 'SA_9EVCEZKC';
  const authToken = bi.voice_vobiz_auth_token || profile.voice_vobiz_auth_token || 'ob4evRjgH4uuqMwKZXo2TqBM13hi2YSEPHMthrMJrKimzLjdirAv00g8xox7rzCv';
  const fromPhone = bi.claimed_vobiz_number || profile.voice_twilio_number || '+917965480539';

  console.log('[TEST CALL] Caller credentials:', { authId, fromPhone, businessName: profile.business_name });

  // 2. Fetch or create test lead
  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .ilike('phone', '%8288835235%')
    .maybeSingle();

  if (!lead) {
    console.log('[TEST CALL] Creating test lead for Raman...');
    const { data: createdLead, error: cErr } = await supabaseAdmin
      .from('leads')
      .insert({
        user_id: userId,
        name: 'Raman',
        phone: targetPhone,
        email: 'raman@nobogent.com',
        status: 'NEW',
        calling_enabled: true,
        voice_campaign_id: voiceCampaignId,
        custom_fields: {
          meta_ad_origin: {
            campaign_name: 'Amrithavana Farm Project | Bilikere Mysuru',
            product_name: 'AMRITHAVANA FARM PROJECT',
            headline: '🌿 Luxury Managed Farmland with Geodesic Dome at ₹50L'
          },
          planned_budget: '₹50 Lakhs (Launch Offer)',
          preferred_plot_size: '6,000 Sq.Ft Farm Plot with Geodesic Dome',
          location_interest: 'Bilikere, Mysuru-Madikeri Highway',
          is_instant_form: true,
          qualification_completed: true
        }
      })
      .select()
      .single();
    if (cErr) throw cErr;
    lead = createdLead;
  }

  console.log(`[TEST CALL] Lead resolved: ${lead.id} (${lead.name}, ${lead.phone})`);

  // 3. Pre-warm voice bridge session
  console.log('[TEST CALL] Pre-warming voice bridge session...');
  const bridgeUrl = 'https://gemini-voice-bridge-805895515412.us-central1.run.app';
  try {
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
    console.log('[TEST CALL] Prewarm triggered successfully.');
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

  if (res.ok && parsed && (parsed.call_uuid || parsed.message === 'call initiated' || parsed.message === 'call queued' || parsed.success !== false)) {
    console.log('✓ TEST CALL SUCCESSFULLY DIALED TO:', targetPhone);
    console.log('Call Request UUID:', parsed.request_uuid || parsed.call_uuid);
    return { success: true, requestUuid: parsed.request_uuid || parsed.call_uuid };
  } else {
    console.error('✗ Call initiation failed:', rawRes);
    return { success: false, error: rawRes };
  }
}

runTestCall().catch(console.error);
