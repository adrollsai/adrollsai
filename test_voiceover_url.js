const https = require('https');

const badAudioUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/voiceover/1785935354239_2fee54a91c5007542fe0c8855ed92c70.mp3";
const cleanAudioUrl = badAudioUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/');

function check(u) {
  return new Promise(resolve => {
    https.get(u, { method: 'HEAD' }, res => resolve(res.statusCode)).on('error', () => resolve(500));
  });
}

async function runTest() {
  console.log("BAD AUDIO URL:", badAudioUrl);
  console.log("BAD AUDIO URL Status:", await check(badAudioUrl));

  console.log("\nCLEAN AUDIO URL:", cleanAudioUrl);
  console.log("CLEAN AUDIO URL Status:", await check(cleanAudioUrl));
}

runTest();
