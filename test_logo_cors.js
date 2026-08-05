const https = require('https');

const logoUrl = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/42d2e0c5-4fe6-4738-8a9f-63f09be01f12-1778827763343.png";

https.get(logoUrl, { headers: { 'Origin': 'https://remotionlambda-useast1-k8ta4ch4gl.s3.us-east-1.amazonaws.com' } }, (res) => {
  console.log("Logo HTTP Status:", res.statusCode);
  console.log("Access-Control-Allow-Origin:", res.headers['access-control-allow-origin']);
  console.log("Content-Type:", res.headers['content-type']);
}).on('error', (e) => {
  console.error("Logo fetch error:", e);
});
