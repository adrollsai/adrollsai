const fetch = require('node-fetch');

async function testRender() {
  const assetId = "e1f82e62-0117-4699-95b7-f41bfc1ec93d";
  const videoUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/explicit_mapped_voiceover_1785759164984.mp4";

  console.log(`Testing video render for valid 200 OK asset ${assetId}...`);

  const response = await fetch("http://localhost:3000/api/video/render", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assetId,
      videoUrl,
      captions: [
        { start: 0, end: 1.5, text: "GNR HOMES MOHALI 🏡", emphasis: true },
        { start: 1.5, end: 3.5, text: "LUXURY 3BHK FLATS", emphasis: false }
      ],
      effects: [],
      theme: "classic"
    })
  });

  const data = await response.json();
  console.log("Render API Response:", data);
}

testRender();
