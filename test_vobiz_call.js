const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testVobizCall() {
  const args = process.argv.slice(2);
  let targetPhone = '+918288835235'; // Default user phone

  for (const arg of args) {
    if (arg.startsWith('--phone=')) {
      targetPhone = arg.split('=')[1].trim();
    } else if (arg.startsWith('+') || /^\d{10,}$/.test(arg)) {
      targetPhone = arg.trim();
    }
  }

  // Format to E.164
  let cleanPhone = targetPhone.replace(/\D/g, '');
  if (!cleanPhone.startsWith('+')) {
    if (cleanPhone.length === 10) {
      cleanPhone = '+91' + cleanPhone;
    } else {
      cleanPhone = '+' + cleanPhone;
    }
  }

  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram / Admin profile
  const campaignId = '65085d5d-2d7d-461b-a682-bdd0adb95b16'; // Active Farmhouse voice campaign

  console.log('====================================================');
  console.log('       VOBIZ AI TELEPHONY TEST CALL RUNNER          ');
  console.log('====================================================');
  console.log(`Caller ID (Vobiz Trial): ${process.env.VOBIZ_TEST_NUMBER || '+911171366938'}`);
  console.log(`Destination Phone:       ${cleanPhone}`);
  console.log(`Profile ID:              ${userId}`);
  console.log(`Campaign ID:             ${campaignId}`);
  console.log('----------------------------------------------------');

  // 1. Ensure test lead exists in Supabase
  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .ilike('phone', `%${cleanPhone.slice(-10)}%`)
    .maybeSingle();

  if (!lead) {
    console.log(`[1/3] Creating test lead for ${cleanPhone}...`);
    const { data: newLead, error: createErr } = await supabaseAdmin
      .from('leads')
      .insert({
        user_id: userId,
        name: 'Raman (Test Call)',
        phone: cleanPhone,
        source: 'Vobiz Telephony Test',
        voice_campaign_id: campaignId,
        voice_call_status: 'calling',
        notes: 'Testing Vobiz Telephony integration with Gemini 3.1 Flash Live voice agent.'
      })
      .select()
      .single();

    if (createErr) {
      console.error('Error creating test lead:', createErr);
      return;
    }
    lead = newLead;
  } else {
    console.log(`[1/3] Found existing lead ID: ${lead.id}. Resetting status to 'calling'...`);
    await supabaseAdmin
      .from('leads')
      .update({
        voice_campaign_id: campaignId,
        voice_call_status: 'calling',
        voice_call_retry_count: 0,
        voice_call_summary: null,
        voice_call_transcript: null,
        last_called_at: new Date().toISOString()
      })
      .eq('id', lead.id);
  }

  // 2. Call Vobiz REST API to trigger outbound call
  const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
  const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
  const callerId = process.env.VOBIZ_TEST_NUMBER || '+911171366938';

  let customTunnel = null;
  for (const arg of args) {
    if (arg.startsWith('--tunnel=')) customTunnel = arg.split('=')[1].trim().replace(/\/$/, '');
    if (arg.startsWith('--url=')) customTunnel = arg.split('=')[1].trim().replace(/\/$/, '');
  }

  if (!customTunnel) {
    try {
      const ngrokRes = await fetch('http://127.0.0.1:4040/api/tunnels');
      if (ngrokRes.ok) {
        const ngrokData = await ngrokRes.json();
        const activeTunnel = ngrokData.tunnels?.find(t => t.public_url?.startsWith('https'));
        if (activeTunnel?.public_url) {
          customTunnel = activeTunnel.public_url.replace(/\/$/, '');
          console.log(`[TUNNEL] Auto-detected active ngrok tunnel: ${customTunnel}`);
        }
      }
    } catch (e) {}
  }

  let answerUrl;
  let hangupUrl;

  if (customTunnel) {
    answerUrl = `${customTunnel}/vobiz-xml?leadId=${lead.id}&profileId=${userId}&campaignId=${campaignId}`;
    hangupUrl = `${customTunnel}/vobiz-status?leadId=${lead.id}`;
  } else {
    let appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
    if (appUrl.includes('localhost') || appUrl.includes('local.nobogent.com')) {
      appUrl = 'https://app.nobogent.com';
    }
    answerUrl = `${appUrl}/api/voice/vobiz/xml?leadId=${lead.id}&profileId=${userId}&campaignId=${campaignId}`;
    hangupUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${lead.id}`;
  }

  const payload = {
    from: callerId,
    to: cleanPhone,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST'
  };

  console.log(`[2/3] Dispatching outbound call via Vobiz API...`);
  console.log(`      Endpoint: POST https://api.vobiz.ai/api/v1/Account/${authId}/Call/`);
  console.log(`      Answer URL: ${answerUrl}`);

  try {
    const res = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/`, {
      method: 'POST',
      headers: {
        'X-Auth-ID': authId,
        'X-Auth-Token': authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log(`[3/3] Vobiz Response Status [${res.status}]:`, JSON.stringify(data, null, 2));

    if (res.ok) {
      console.log('\n====================================================');
      console.log('  SUCCESS! CALL DISPATCHED VIA VOBIZ TELEPHONY      ');
      console.log('====================================================');
      console.log(`  Call Request UUID: ${data.request_uuid || data.api_id || data.call_uuid}`);
      console.log(`  Message:           ${data.message || 'Call queued'}`);
      console.log(`\n  What to do next:`);
      console.log(`  1. Look out for an incoming call from ${callerId} on your phone ${cleanPhone}`);
      console.log(`  2. Answer the call to speak directly with the Gemini 3.1 Flash Live voice agent in Hindi/Hinglish.`);
      console.log(`  3. Test barge-in, asking questions about properties/projects, and appointment booking.`);
      console.log(`  4. Check the call transcript & summary in Nobogent leads table after hanging up.`);
      console.log('====================================================\n');
    } else {
      console.error('\n❌ Call dispatch failed:', data);
    }
  } catch (err) {
    console.error('\n❌ Network error while calling Vobiz:', err);
  }
}

testVobizCall();
