const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

async function check() {
    const tid = "f64a3da7638354e7ed2805ff8d848d81";
    console.log(`Checking Kie.ai status for task ${tid}...`);
    const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${tid}`, {
        headers: { 'Authorization': 'Bearer ' + key }
    });
    const json = await res.json();
    console.log("Kie State:", json.data?.state);
    console.log("Result JSON:", json.data?.resultJson);
    console.log("Fail Msg:", json.data?.failMsg || json.data?.failReason);
}

check().catch(console.error);
