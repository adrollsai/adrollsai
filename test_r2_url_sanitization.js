const https = require('https');

const badUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/explicit_mapped_voiceover_1785759164984.mp4";
const cleanUrl = badUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/');

function check(u) {
  return new Promise(resolve => {
    https.get(u, { method: 'HEAD' }, res => resolve(res.statusCode)).on('error', () => resolve(500));
  });
}

async function runTest() {
  console.log("BAD URL:", badUrl);
  console.log("BAD URL HTTP Status:", await check(badUrl));

  console.log("\nCLEAN URL:", cleanUrl);
  console.log("CLEAN URL HTTP Status:", await check(cleanUrl));
}

runTest();
