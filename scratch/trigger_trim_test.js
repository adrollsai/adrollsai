require('dotenv').config({ path: '.env.local' });


const CLOUD_RUN_URL = process.env.REMOTION_RENDERER_URL || "https://adrolls-remotion-renderer-805895515412.us-central1.run.app";
const avatarUrl = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/character-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1780561506878.mp4";
const userId = "9bbf6e51-283e-48d1-bbb4-8dc546cc74b2";

async function triggerTrimTest() {
    const endpoint = `${CLOUD_RUN_URL.replace(/\/$/, '')}/process-avatar`;
    console.log(`[Test] Calling Cloud Run endpoint: ${endpoint}`);
    console.log(`[Test] Payload:`, { avatarUrl, userId });

    try {
        const start = Date.now();
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ avatarUrl, userId })
        });

        const status = response.status;
        const result = await response.json();
        const duration = ((Date.now() - start) / 1000).toFixed(2);

        console.log(`[Test] Response Status: ${status} (took ${duration}s)`);
        console.log(`[Test] Response Data:`, JSON.stringify(result, null, 2));

        if (response.ok && result.success) {
            console.log(`\n[SUCCESS] The Cloud Run service successfully trimmed, scaled, and uploaded the video to R2!`);
            console.log(`- Trimmed Video URL: ${result.videoUrl}`);
            console.log(`- Extracted Audio URL: ${result.audioUrl}`);
        } else {
            console.error(`\n[FAILED] Trimming failed or returned success = false.`);
        }
    } catch (e) {
        console.error(`[Test] Request failed:`, e);
    }
}

triggerTrimTest();
