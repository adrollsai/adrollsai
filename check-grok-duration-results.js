const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

const taskIds = {
    "duration:15 TOP LEVEL": "24bab05db6c853cdc33f53d764834278",
    "video_length:15 in input": "22eca5816e31d39ba3c2b1a1d40ccd22",
    "length:15 in input": "8a39b949aedc6f9a2636a8d452d98185",
    "seconds:15 in input": "16c0f0b9d2238641fc43660963216ae0",
    "clip_length:15 in input": "ef73ce0f250a3761a1113fa3e2623f8f",
    "output_duration:15 in input": "d20518ee600b67f8d240edaf44302407",
};

async function checkAll() {
    for (const [label, taskId] of Object.entries(taskIds)) {
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            headers: { 'Authorization': 'Bearer ' + key }
        });
        const json = await res.json();
        const state = json.data?.state;
        const resultJson = json.data?.resultJson;
        let url = null;
        if (resultJson) {
            try { url = JSON.parse(resultJson).resultUrls?.[0]; } catch(e) {}
        }
        console.log(`[${label}] state=${state} | url=${url || 'N/A'}`);
    }
}

checkAll().catch(console.error);
