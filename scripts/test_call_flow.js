const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testCall() {
  const { data: prof } = await supabase.from('profiles').select('*').eq('email', 'rchopra489@gmail.com').single();
  const { data: lead } = await supabase.from('leads').select('*').ilike('phone', '%8288835235%').limit(1).single();

  console.log('Testing outbound call initiation:');
  console.log('Profile:', prof.id, prof.email);
  console.log('Lead:', lead.id, lead.name, lead.phone);

  // Check Twilio call params
  const twilioSid = prof.voice_twilio_sid || process.env.MASTER_TWILIO_SID;
  const twilioToken = prof.voice_twilio_token || process.env.MASTER_TWILIO_TOKEN;
  let voiceNumber = prof.voice_twilio_number || process.env.MASTER_TWILIO_NUMBER;
  if (voiceNumber === '+911171366938' || voiceNumber?.startsWith('+91')) {
    voiceNumber = process.env.MASTER_TWILIO_NUMBER || '+16592137728';
  }

  let cleanPhone = lead.phone.replace(/\D/g, '');
  if (!cleanPhone.startsWith('+')) {
    if (cleanPhone.length === 10) cleanPhone = '+91' + cleanPhone;
    else cleanPhone = '+' + cleanPhone;
  }

  const appUrl = 'https://app.nobogent.com';
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`;
  const twilioAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');

  const params = new URLSearchParams();
  params.append('Url', `${appUrl}/api/voice/twiml?leadId=${lead.id}&profileId=${prof.id}`);
  params.append('To', cleanPhone);
  params.append('From', voiceNumber.trim());

  console.log('\nSending Twilio call request:');
  console.log('To:', cleanPhone);
  console.log('From:', voiceNumber.trim());
  console.log('Twiml URL:', `${appUrl}/api/voice/twiml?leadId=${lead.id}&profileId=${prof.id}`);

  const res = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${twilioAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  console.log('Twilio HTTP status:', res.status);
  const data = await res.json();
  console.log('Twilio API response:', data);
}

testCall();
