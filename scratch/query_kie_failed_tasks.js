require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const KIE_API_KEY = process.env.KIE_API_KEY;
const TASKS = ["8acd986889affbab6f7417c2adf4f799", "9ee7e6aaf9a768ded9b61afb2656d8b5"];

async function queryTask(taskId) {
    console.log(`Querying task: ${taskId}...`);
    try {
        const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${KIE_API_KEY}`
            }
        });
        if (!response.ok) {
            console.error(`HTTP error: ${response.status} ${response.statusText}`);
            return;
        }
        const data = await response.json();
        console.log(`Response for ${taskId}:`);
        console.log(`  Status: ${data.data?.status}`);
        console.log(`  FailCode: ${data.data?.failCode}`);
        console.log(`  FailMsg: ${data.data?.failMsg}`);
        console.log(`  Input:`, JSON.stringify(data.data?.input, null, 2));
    } catch (e) {
        console.error(`Error querying task ${taskId}:`, e);
    }
}

async function main() {
    if (!KIE_API_KEY) {
        console.error("KIE_API_KEY is not defined in the environment.");
        return;
    }
    for (const task of TASKS) {
        await queryTask(task);
        console.log("------------------");
    }
}

main();
