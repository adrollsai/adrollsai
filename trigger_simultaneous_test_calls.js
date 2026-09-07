const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function triggerSimultaneousCalls() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram
  const campaignId = '702a2914-544f-40a0-a14f-3ae28ed6f6be'; // Mohali Aerocity Commercial Properties

  const numbers = [
    { phone: '+918288835235', name: 'Raman' },
    { phone: '+918284090052', name: 'Vikram' }
  ];

  console.log(`[SIMULTANEOUS TEST] Fetching Khushi Ram profile & credentials...`);
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  const authId = profile.voice_vobiz_auth_id || process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
  const authToken = profile.voice_vobiz_auth_token || process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
  const callerId = profile.voice_vobiz_number || profile.voice_twilio_number || '+917965853341';
  const appUrl = 'https://app.nobogent.com';

  console.log(`Caller ID: ${callerId}`);
  console.log(`Campaign ID: ${campaignId}`);

  // Warmup cloud run voice bridge
  console.log('[SIMULTANEOUS TEST] Warming up Voice Bridge container...');
  try {
    await fetch('https://gemini-voice-bridge-805895515412.us-central1.run.app/health');
    console.log('[SIMULTANEOUS TEST] Voice Bridge container warmed up.');
  } catch (wErr) {
    console.warn('[SIMULTANEOUS TEST] Warmup warning:', wErr.message);
  }

  const leadsToCall = [];

  for (const n of numbers) {
    let { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, custom_fields')
      .eq('user_id', userId)
      .ilike('phone', `%${n.phone.slice(-10)}%`)
      .maybeSingle();

    if (!lead) {
      console.log(`Creating lead for ${n.name} (${n.phone})...`);
      const { data: created, error: cErr } = await supabaseAdmin
        .from('leads')
        .insert({
          user_id: userId,
          name: n.name,
          phone: n.phone,
          source: 'Live Campaign Test',
          voice_campaign_id: campaignId,
          voice_call_status: 'calling',
          custom_fields: { skip_credit_deduction: true, skip_prospect_whatsapp: true }
        })
        .select()
        .single();

      if (cErr) {
        console.error(`Error creating lead for ${n.phone}:`, cErr);
        continue;
      }
      lead = created;
    } else {
      console.log(`Found lead ${lead.name} (ID: ${lead.id}), updating...`);
      let cf = lead.custom_fields || {};
      if (typeof cf === 'string') {
        try { cf = JSON.parse(cf); } catch (e) { cf = {}; }
      }
      cf.skip_credit_deduction = true;
      cf.skip_prospect_whatsapp = true;

      await supabaseAdmin
        .from('leads')
        .update({
          name: n.name,
          voice_campaign_id: campaignId,
          voice_call_status: 'calling',
          voice_call_retry_count: 0,
          custom_fields: cf,
          last_called_at: new Date().toISOString()
        })
        .eq('id', lead.id);
    }

    leadsToCall.push({ id: lead.id, name: n.name, phone: n.phone });
  }

  console.log(`\n======================================================`);
  console.log(`[SIMULTANEOUS TEST] INITIATING 2 PARALLEL CALLS RIGHT NOW`);
  console.log(`======================================================`);

  const callPromises = leadsToCall.map(async (l) => {
    const answerUrl = `https://gemini-voice-bridge-805895515412.us-central1.run.app/vobiz-xml?leadId=${l.id}&profileId=${userId}&campaignId=${campaignId}`;
    const hangupUrl = `https://gemini-voice-bridge-805895515412.us-central1.run.app/vobiz-status?leadId=${l.id}`;

    const payload = {
      from: callerId,
      to: l.phone,
      answer_url: answerUrl,
      answer_method: 'POST',
      hangup_url: hangupUrl,
      hangup_method: 'POST'
    };

    console.log(`[DIALING] Initiating call to ${l.name} (${l.phone})...`);
    try {
      const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;
      const res = await fetch(vobizUrl, {
        method: 'POST',
        headers: {
          'X-Auth-ID': authId,
          'X-Auth-Token': authToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      console.log(`[RESPONSE] ${l.name} (${l.phone}) status ${res.status}:`, data);
      return { lead: l.name, phone: l.phone, success: res.ok, data };
    } catch (err) {
      console.error(`[ERROR] Dialing ${l.phone} failed:`, err.message);
      return { lead: l.name, phone: l.phone, success: false, error: err.message };
    }
  });

  const results = await Promise.all(callPromises);
  console.log('\n======================================================');
  console.log('BOTH CALLS DISPATCHED SIMULTANEOUSLY:');
  console.log(JSON.stringify(results, null, 2));
  console.log('======================================================\n');
}

triggerSimultaneousCalls();
