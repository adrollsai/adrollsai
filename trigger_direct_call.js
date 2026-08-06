const https = require('https');
const querystring = require('querystring');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function callLead() {
  const leadId = "dab2806f-3a68-4f0d-a3b0-bb3dab69816e";
  
  // 1. Fetch lead
  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', leadId).single();
  if (!lead) return console.error("Lead not found!");

  console.log(`Found lead: ${lead.name} (${lead.phone})`);

  // Reset lead status in DB
  await supabaseAdmin
    .from('leads')
    .update({
      voice_call_status: 'calling',
      voice_call_retry_count: 0,
      voice_call_scheduled_at: null,
      voice_call_summary: null,
      voice_call_transcript: []
    })
    .eq('id', leadId);

  const sid = process.env.MASTER_TWILIO_SID;
  const token = process.env.MASTER_TWILIO_TOKEN;
  const fromNumber = process.env.MASTER_TWILIO_NUMBER;
  const twimlUrl = `https://app.nobogent.com/api/voice/twiml?leadId=${lead.id}&profileId=${lead.user_id}`;
  const statusCallback = `https://app.nobogent.com/api/voice/status-callback?leadId=${lead.id}`;

  const postData = querystring.stringify({
    To: lead.phone,
    From: fromNumber,
    Url: twimlUrl,
    StatusCallback: statusCallback,
    StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
  });

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const options = {
    hostname: 'api.twilio.com',
    port: 443,
    path: `/2010-04-01/Accounts/${sid}/Calls.json`,
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  console.log(`Sending call request to Twilio API for ${lead.phone}...`);

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`Twilio API Response [${res.statusCode}]:`, body);
    });
  });

  req.on('error', e => console.error("Twilio request error:", e));
  req.write(postData);
  req.end();
}

callLead();
