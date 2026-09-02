require('dotenv').config({ path: '.env.local' });

async function testFromFormats() {
  const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
  const authToken = process.env.VOBIZ_AUTH_TOKEN;
  
  const fromVariations = [
    '+911171366938',
    '911171366938',
    '01171366938',
    '1171366938',
    '+918288835235',
    '918288835235'
  ];

  for (const fromNum of fromVariations) {
    console.log(`\nTesting FROM: "${fromNum}"...`);
    const payload = {
      from: fromNum,
      to: '+918288835235',
      answer_url: 'https://app.nobogent.com/api/voice/vobiz/xml?test=1',
      answer_method: 'POST'
    };

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
      console.log(`HTTP ${res.status}:`, data);
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

testFromFormats();
