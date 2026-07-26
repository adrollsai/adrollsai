const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

const supabasePublicUrl = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1779799853507-yshfya.jpg";

async function testSupabaseGrok() {
    const payload = {
        model: "grok-imagine-video-1-5-preview",
        input: {
            prompt: "Reference 9:16 collage image as identity lock. Create an ultrarealistic live-action 9:16 commercial featuring an animated A-roll of the products with a slow dramatic push-in zoom, soft studio lighting. Silent video clip without any voiceover, speech, talking, background narration, ambient audio, or text overlays.",
            aspect_ratio: "9:16",
            resolution: "480p",
            nsfw_checker: true,
            image_urls: [supabasePublicUrl]
        }
    };

    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
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
            const infoRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers: { 'Authorization': `Bearer ${key}` } });
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
        }
    }
}

testSupabaseGrok();
