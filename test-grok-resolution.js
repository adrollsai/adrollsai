const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

// The user's 15s clip was generated with user ID 841a5ae8
// Let's try different resolutions - maybe higher res = longer clip
async function testResolutions() {
    const resolutions = ['720p', '1080p', '4k'];
    
    for (const res of resolutions) {
        console.log(`\n=== Test: resolution=${res} (no duration param) ===`);
        const payload = {
            model: "grok-imagine-video-1-5-preview",
            input: {
                prompt: "A luxury real estate aerial establishing shot of a modern apartment complex. Silent video clip without any voiceover or text.",
                aspect_ratio: "9:16",
                resolution: res,
                nsfw_checker: true
            }
        };
        const r = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await r.json();
        console.log(`Status: ${r.status} | taskId: ${json.data?.taskId} | code: ${json.code} | msg: ${json.msg}`);
    }
}

// Also try with duration: 15 inside input (the original that previously failed might have been a transient error)
async function testDurationInInput() {
    console.log(`\n=== Test: duration:15 INSIDE input (re-test) ===`);
    const payload = {
        model: "grok-imagine-video-1-5-preview",
        input: {
            prompt: "A luxury real estate aerial establishing shot of a modern apartment complex. Silent video clip without any voiceover or text.",
            aspect_ratio: "9:16",
            resolution: "480p",
            duration: 15,
            nsfw_checker: true
        }
    };
    const r = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const json = await r.json();
    console.log(`Status: ${r.status} | taskId: ${json.data?.taskId} | code: ${json.code} | msg: ${json.msg}`);
    return json.data?.taskId;
}

// Try with resolution 720p AND duration 15 together
async function testResolutionPlusDuration() {
    console.log(`\n=== Test: resolution=720p + duration:15 in input ===`);
    const payload = {
        model: "grok-imagine-video-1-5-preview",
        input: {
            prompt: "A luxury real estate aerial establishing shot of a modern apartment complex. Silent video clip without any voiceover or text.",
            aspect_ratio: "9:16",
            resolution: "720p",
            duration: 15,
            nsfw_checker: true
        }
    };
    const r = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const json = await r.json();
    console.log(`Status: ${r.status} | taskId: ${json.data?.taskId} | code: ${json.code} | msg: ${json.msg}`);
    return json.data?.taskId;
}

async function main() {
    await testResolutions();
    const tid1 = await testDurationInInput();
    const tid2 = await testResolutionPlusDuration();
    
    if (tid1 || tid2) {
        console.log('\n=== Task IDs to check later ===');
        if (tid1) console.log(`duration:15 in input = ${tid1}`);
        if (tid2) console.log(`resolution=720p + duration:15 = ${tid2}`);
    }
}
main().catch(console.error);
