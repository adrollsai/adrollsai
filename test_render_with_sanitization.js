const http = require('http');

async function testRender() {
  const assetId = "e1f82e62-0117-4699-95b7-f41bfc1ec93d";
  // Send the BAD URL with /adrolls-storage/ to verify our backend automatically sanitizes it to 200 OK!
  const videoUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/explicit_mapped_voiceover_1785759164984.mp4";

  console.log(`[Test Sanitized Render] Sending videoUrl containing /adrolls-storage/...`);

  const payload = JSON.stringify({
    assetId,
    videoUrl,
    captions: [
      { start: 0, end: 1.5, text: "GNR HOMES MOHALI 🏡", emphasis: true },
      { start: 1.5, end: 3.5, text: "LUXURY 3BHK FLATS", emphasis: false }
    ],
    effects: [],
    theme: "classic"
  });

  const req = http.request("http://localhost:3000/api/video/render", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mock-User': '42d2e0c5-4fe6-4738-8a9f-63f09be01f12',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`Response Status: ${res.statusCode}`);
      console.log(`Body:`, body);
    });
  });

  req.on('error', (e) => console.error(e));
  req.write(payload);
  req.end();
}

testRender();
