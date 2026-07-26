const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

async function check() {
    const tid = '0fcbbafca6c1b008163b61a70c8e3666';
    const res = await fetch('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=' + tid, { headers: { 'Authorization': 'Bearer ' + key } });
    const json = await res.json();
    console.log("Grok Clip 2 Task ID:", tid);
    console.log("STATE:", json.data?.state);
    console.log("RESULT JSON:", json.data?.resultJson);
    console.log("FAIL MSG:", json.data?.failMsg || json.data?.failReason);
}
check();
