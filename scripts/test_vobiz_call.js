const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testCallDirect() {
  const { data: prof } = await supabase.from('profiles').select('*').eq('email', 'rchopra489@gmail.com').single();
  const { data: lead } = await supabase.from('leads').select('*').ilike('phone', '%8288835235%').limit(1).single();
  console.log('Profile:', prof.id, prof.email);
  console.log('Lead:', lead.id, lead.name, lead.phone);

  const authId = prof.voice_vobiz_auth_id || process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
  const authToken = prof.voice_vobiz_auth_token || process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
  const callerId = prof.voice_vobiz_number || prof.voice_twilio_number || process.env.VOBIZ_TEST_NUMBER || '+911171366938';

  const appUrl = 'https://app.nobogent.com';
  const cleanPhone = '+918288835235';
  const answerUrl = `${appUrl}/api/voice/vobiz/xml?leadId=${lead.id}&profileId=${prof.id}`;
  const hangupUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${lead.id}`;

  const requestPayload = {
    from: callerId,
    to: cleanPhone,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST'
  };

  console.log('\nPayload sending to Vobiz:');
  console.log(JSON.stringify(requestPayload, null, 2));

  const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;
  console.log('\nSending POST to:', vobizUrl);
  
  const res = await fetch(vobizUrl, {
    method: 'POST',
    headers: {
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestPayload)
  });

  console.log('Vobiz HTTP Status:', res.status);
  const text = await res.text();
  console.log('Vobiz Raw Response:', text);
}

testCallDirect();
