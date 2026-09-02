require('dotenv').config({ path: '.env.local' });

async function testTwilioCall() {
  const twilioSid = process.env.MASTER_TWILIO_SID;
  const twilioToken = process.env.MASTER_TWILIO_TOKEN;
  const voiceNumber = process.env.MASTER_TWILIO_NUMBER;
  const toPhone = '+918288835235';

  console.log('Twilio test configuration:', { twilioSid, voiceNumber, toPhone });
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}.json`;
  const twilioAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');

  const accRes = await fetch(twilioUrl, {
    headers: { 'Authorization': `Basic ${twilioAuth}` }
  });
  console.log('Twilio Account Status:', accRes.status);
  const accData = await accRes.json();
  console.log('Twilio Account Name:', accData.friendly_name, '| Status:', accData.status);
}

testTwilioCall();
