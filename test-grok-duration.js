const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

// The 15s clip URL user provided. The user ID in it is: 841a5ae8-0f5d-47ad-8de9-61a0bd1efa4a
// Let's find any recent Grok tasks that produced 15s clips by searching our task history
async function searchRecentGrokTasks() {
    // Try the task list endpoint to find recent grok tasks
    const endpoints = [
        'https://api.kie.ai/api/v1/jobs/list?page=1&pageSize=20',
        'https://api.kie.ai/api/v1/jobs?page=1&size=20',
        'https://api.kie.ai/api/v1/task/list',
        'https://api.kie.ai/api/v1/jobs/records',
    ];
    
    for (const ep of endpoints) {
        const res = await fetch(ep, { headers: { 'Authorization': 'Bearer ' + key } });
        if (res.status === 200) {
            const json = await res.json();
            console.log(`\nEndpoint ${ep} works! Status: ${res.status}`);
            console.log(JSON.stringify(json, null, 2).substring(0, 3000));
            return;
        }
        console.log(`Endpoint ${ep}: ${res.status}`);
    }
}

// Also try submitting with just duration at top level to see the exact error/success message
async function testGrokWithDurationTopLevel() {
    console.log("\n=== Test: duration: 15 at TOP LEVEL of payload ===");
    const payload = {
        model: "grok-imagine-video-1-5-preview",
        duration: 15,
        input: {
            prompt: "A luxury real estate aerial establishing shot. Silent video clip without any voiceover or text.",
            aspect_ratio: "9:16",
            resolution: "480p",
            nsfw_checker: true
        }
    };
    const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    console.log("Response status:", res.status);
    console.log("Response:", JSON.stringify(json, null, 2));
}

// Try with video_length or seconds or length
async function testOtherDurationKeys() {
    const variants = [
        { key: 'video_length', value: 15 },
        { key: 'length', value: 15 },
        { key: 'seconds', value: 15 },
        { key: 'clip_length', value: 15 },
        { key: 'output_duration', value: 15 },
    ];
    
    for (const variant of variants) {
        console.log(`\n=== Test: ${variant.key}: ${variant.value} inside input ===`);
        const inputPayload = {
            prompt: "A luxury real estate aerial establishing shot. Silent video clip without any voiceover or text.",
            aspect_ratio: "9:16",
            resolution: "480p",
            nsfw_checker: true,
            [variant.key]: variant.value
        };
        const payload = {
            model: "grok-imagine-video-1-5-preview",
            input: inputPayload
        };
        const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        console.log("Status:", res.status, "| taskId:", json.data?.taskId, "| code:", json.code, "| msg:", json.msg);
    }
}

async function main() {
    await searchRecentGrokTasks();
    await testGrokWithDurationTopLevel();
    await testOtherDurationKeys();
}
main().catch(console.error);
