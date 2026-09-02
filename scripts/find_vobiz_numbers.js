require('dotenv').config({ path: '.env.local' });

async function findVobizNumbers() {
  const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
  const authToken = process.env.VOBIZ_AUTH_TOKEN;

  // Let's test different headers and endpoints on Vobiz
  const endpoints = [
    `https://api.vobiz.ai/api/v1/Account/${authId}/Number/`,
    `https://api.vobiz.ai/api/v1/Account/${authId}/PhoneNumber/`,
    `https://api.vobiz.ai/api/v1/Account/${authId}/`
  ];

  // 1. Basic Auth vs Header Auth
  const basicAuth = Buffer.from(`${authId}:${authToken}`).toString('base64');

  for (const ep of endpoints) {
    console.log('\n--- Checking endpoint:', ep);
    
    // Attempt 1: X-Auth-ID / X-Auth-Token
    try {
      const r1 = await fetch(ep, {
        headers: {
          'X-Auth-ID': authId,
          'X-Auth-Token': authToken
        }
      });
      console.log('Using X-Auth headers -> Status:', r1.status);
      const t1 = await r1.text();
      console.log('Response:', t1.slice(0, 300));
    } catch (e) {
      console.log('Error 1:', e.message);
    }

    // Attempt 2: Basic Auth
    try {
      const r2 = await fetch(ep, {
        headers: {
          'Authorization': `Basic ${basicAuth}`
        }
      });
      console.log('Using Basic Auth -> Status:', r2.status);
      const t2 = await r2.text();
      console.log('Response:', t2.slice(0, 300));
    } catch (e) {
      console.log('Error 2:', e.message);
    }
  }
}

findVobizNumbers();
