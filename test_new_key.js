const https = require('https');

const newKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";

async function testKey() {
  console.log("Testing new key...");
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${newKey}`;
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log("HTTP STATUS:", res.statusCode);
      console.log("RESPONSE:", data.substring(0, 300));
    });
  }).on('error', (e) => console.error(e));
}

testKey();
