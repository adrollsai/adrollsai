require('dotenv').config({ path: '.env.local' });

async function checkVobizAccountDetails() {
  const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
  const authToken = process.env.VOBIZ_AUTH_TOKEN;

  console.log('Testing with Auth ID:', authId);

  const testUrls = [
    `https://api.vobiz.ai/api/v1/Account/${authId}/Subaccount/`,
    `https://api.vobiz.ai/api/v1/Account/${authId}/Application/`,
    `https://api.vobiz.ai/api/v1/Account/${authId}/Endpoint/`,
    `https://api.vobiz.ai/api/v1/Account/${authId}/Profile/`
  ];

  for (const u of testUrls) {
    console.log(`\nGET ${u}...`);
    try {
      const res = await fetch(u, {
        headers: {
          'X-Auth-ID': authId,
          'X-Auth-Token': authToken
        }
      });
      console.log(`Status: ${res.status}`);
      const text = await res.text();
      console.log(`Response: ${text.slice(0, 400)}`);
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

checkVobizAccountDetails();
