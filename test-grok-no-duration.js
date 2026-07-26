const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.ok) return res;
            console.warn(`HTTP ${res.status}, retrying ${i + 1}/${retries}...`);
        } catch (err) {
            console.warn(`Fetch error: ${err.message}, retrying ${i + 1}/${retries}...`);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    return fetch(url, options);
}

async function testGrokNoDuration() {
    const payload = {
        model: "grok-imagine-video-1-5-preview",
        input: {
            prompt: "Reference 9:16 collage image as identity lock. Create an ultrarealistic live-action 9:16 commercial featuring an animated A-roll of the products with a slow dramatic push-in zoom, soft studio lighting. Silent video clip without any voiceover, speech, talking, background narration, ambient audio, or text overlays.",
            aspect_ratio: "9:16",
            resolution: "480p",
            nsfw_checker: true,
            image_urls: ["https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/ananta_aspire_collage_916_1785049367838.jpg"]
        }
    };

    const res = await fetchWithRetry("https://api.kie.ai/api/v1/jobs/createTask", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    console.log("Task creation result:", json);
    const taskId = json.data?.taskId;

    if (taskId) {
        console.log(`Task ${taskId} created. Polling completion...`);
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const infoRes = await fetchWithRetry(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers: { 'Authorization': `Bearer ${key}` } });
                const infoJson = await infoRes.json();
                console.log(`[Attempt ${i + 1}] State: ${infoJson.data?.state}`);
                if (infoJson.data?.state === 'success') {
                    console.log("SUCCESS RESULT JSON:", infoJson.data?.resultJson);
                    break;
                }
                if (infoJson.data?.state === 'fail') {
                    console.log("FAIL MSG:", infoJson.data?.failMsg || infoJson.data?.failReason);
                    break;
                }
            } catch (pErr) {
                console.warn("Polling error:", pErr.message);
            }
        }
    }
}

testGrokNoDuration();
