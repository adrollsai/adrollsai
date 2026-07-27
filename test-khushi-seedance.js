const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));

const key = env.KIE_API_KEY;

async function test() {
    const payload = {
        model: "bytedance/seedance-2-fast",
        callBackUrl: "https://nobogent.vercel.app/api/video/callback",
        input: {
            prompt: "A professional male real estate advisor speaking directly to camera.",
            aspect_ratio: "9:16",
            duration: 15,
            generate_audio: true,
            resolution: "480p",
            nsfw_checker: true,
            web_search: false,
            reference_video_urls: ["https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/d838c956-1761-4bce-9d91-32f3abecc222/trimmed_ref_v2_29f6070be413c5e8f2325ec493644486.mp4"],
            reference_audio_urls: ["https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/d838c956-1761-4bce-9d91-32f3abecc222/ref_audio_v2_29f6070be413c5e8f2325ec493644486.mp3"]
        }
    };

    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(payload)
    });

    const json = await res.json();
    console.log("Kie.ai Response status:", res.status);
    console.log("Kie.ai Response JSON:", JSON.stringify(json, null, 2));
}

test().catch(console.error);
