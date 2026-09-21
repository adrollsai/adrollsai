const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testCall() {
  const profileId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const leadId = 'eb9c4236-093d-41a2-8249-91c1bbbe371b';
  const campaignId = '702a2914-544f-40a0-a14f-3ae28ed6f6be';
  const toPhone = '+918288835235';

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', profileId).single();
  const callerId = profile.voice_twilio_number || '+917965853341';
  console.log('Profile:', profile.business_name, '| Caller ID:', callerId);

  const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
  const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';

  const appUrl = 'https://app.nobogent.com';
  const answerUrl = `${appUrl}/api/voice/vobiz/xml?leadId=${leadId}&profileId=${profileId}&campaignId=${campaignId}`;
  const hangupUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${leadId}`;

  const payload = {
    from: callerId,
    to: toPhone,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST'
  };

  console.log('Sending Vobiz Call Payload:', JSON.stringify(payload, null, 2));

  // Warm up voice bridge first
  try {
    const bridgeWarmup = await fetch('https://gemini-voice-bridge-805895515412.us-central1.run.app/health');
    console.log('Bridge health check:', bridgeWarmup.status);
  } catch (e) {
    console.warn('Bridge warmup error:', e.message);
  }

  const res = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/`, {
    method: 'POST',
    headers: {
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseJson = await res.json();
  console.log('Vobiz Response Status:', res.status);
  console.log('Vobiz Response Data:', responseJson);

  if (res.ok) {
    await supabase.from('leads').update({
      voice_call_status: 'calling',
      voice_call_scheduled_at: new Date().toISOString()
    }).eq('id', leadId);
    console.log('Updated lead', leadId, 'to calling state.');
  }
}

testCall();
