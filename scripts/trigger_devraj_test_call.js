const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runDevrajTestCall() {
  const userId = 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f'; // RAJ ABHIJNA PROPERTY DEVELOPERS PVT LTD
  const targetPhone = '+916361236018';
  const targetName = 'Devraj';
  const voiceCampaignId = '8e12bad9-7201-43c0-8d08-1d991a28e156'; // Amrithavana Farm Project

  console.log(`================================================================`);
  console.log(`🚀 TRIGGERING TEST CALL TO ${targetName} (${targetPhone})`);
  console.log(`================================================================`);

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

  console.log('[DEVRAJ CALL] Caller credentials:', { authId, fromPhone, businessName: profile.business_name });

  // 2. Fetch or create test lead for Devraj
  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .ilike('phone', '%6361236018%')
    .maybeSingle();

  const customFields = {
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
  };

  if (!lead) {
    console.log('[DEVRAJ CALL] Creating lead for Devraj under Raj Abhijna...');
    const { data: createdLead, error: cErr } = await supabaseAdmin
      .from('leads')
      .insert({
        user_id: userId,
        name: targetName,
        phone: targetPhone,
        email: 'devraj@nobogent.com',
        status: 'NEW',
        calling_enabled: true,
        voice_campaign_id: voiceCampaignId,
        custom_fields: customFields
      })
      .select()
      .single();
    if (cErr) throw cErr;
    lead = createdLead;
  } else {
    const { data: updatedLead } = await supabaseAdmin
      .from('leads')
      .update({
        name: targetName,
        voice_campaign_id: voiceCampaignId,
        custom_fields: customFields,
        voice_call_status: 'ready',
        calling_enabled: true
      })
      .eq('id', lead.id)
      .select()
      .single();
    lead = updatedLead;
  }

  console.log(`[DEVRAJ CALL] Lead resolved: ${lead.id} (${lead.name}, ${lead.phone})`);

  // 3. Pre-warm voice bridge session with Aoede
  console.log('[DEVRAJ CALL] Pre-warming voice bridge session with Aoede...');
  const bridgeUrl = 'https://gemini-voice-bridge-805895515412.us-central1.run.app';
  try {
    const pwRes = await fetch(`${bridgeUrl}/prewarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: lead.id,
        profileId: userId,
        campaignId: voiceCampaignId,
        voiceName: 'Aoede'
      })
    });
    const pwData = await pwRes.json().catch(() => ({}));
    console.log('[DEVRAJ CALL] Prewarm response:', pwData);
  } catch (pwErr) {
    console.warn('[DEVRAJ CALL] Prewarm warning:', pwErr.message);
  }

  // 4. Dial outbound via Vobiz API directly pointing to Cloud Run XML endpoint
  const answerUrl = `${bridgeUrl}/vobiz-xml?leadId=${lead.id}&profileId=${userId}&campaignId=${voiceCampaignId}&voiceName=Aoede`;
  const hangupUrl = `${bridgeUrl}/vobiz-status?leadId=${lead.id}`;

  const requestPayload = {
    from: fromPhone,
    to: targetPhone,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST'
  };

  console.log('\n[DEVRAJ CALL] Dialing Vobiz API with direct Cloud Run payload:', requestPayload);

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
  console.log(`[DEVRAJ CALL] Vobiz Response (${res.status}):`, rawRes);

  let parsed = null;
  try { parsed = JSON.parse(rawRes); } catch (e) {}

  if (res.ok && parsed && (parsed.call_uuid || parsed.message === 'call initiated' || parsed.message === 'call queued' || parsed.success !== false)) {
    console.log('\n================================================================');
    console.log(`✅ TEST CALL SUCCESSFULLY DIALED TO DEVRAJ (${targetPhone})!`);
    console.log('Call Request UUID:', parsed.request_uuid || parsed.call_uuid);
    console.log('================================================================');
    return { success: true, requestUuid: parsed.request_uuid || parsed.call_uuid, leadId: lead.id };
  } else {
    console.error('✗ Call initiation failed:', rawRes);
    return { success: false, error: rawRes };
  }
}

runDevrajTestCall().catch(console.error);
