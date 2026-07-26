const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

async function testGrokDuration(dur) {
    const payload = {
        model: "grok-imagine-video-1-5-preview",
        input: {
            prompt: "Reference 9:16 collage image as identity lock. Create an ultrarealistic live-action 9:16 commercial featuring an animated A-roll of the products with a slow dramatic push-in zoom, soft studio lighting.",
            aspect_ratio: "9:16",
            resolution: "480p",
            duration: dur,
            image_urls: ["https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/ananta_aspire_collage_916_1785049367838.jpg"]
        }
    };

    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    console.log(`Duration ${dur} task creation result:`, json);
}

async function run() {
    await testGrokDuration(5);
    await testGrokDuration(10);
}

run();
