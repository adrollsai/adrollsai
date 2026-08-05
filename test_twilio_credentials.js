const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

function checkTwilio(sid, token) {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${sid}.json`,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', e => resolve({ status: 500, body: e.message }));
    req.end();
  });
}

async function run() {
  console.log("Checking MASTER_TWILIO_SID:", process.env.MASTER_TWILIO_SID);
  console.log("Checking MASTER_TWILIO_TOKEN:", process.env.MASTER_TWILIO_TOKEN);
  const result = await checkTwilio(process.env.MASTER_TWILIO_SID, process.env.MASTER_TWILIO_TOKEN);
  console.log("RESULT:", result);
}

run();
