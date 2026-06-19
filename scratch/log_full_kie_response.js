require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const KIE_API_KEY = process.env.KIE_API_KEY;
const TASKS = ["8acd986889affbab6f7417c2adf4f799", "9ee7e6aaf9a768ded9b61afb2656d8b5"];

async function queryTask(taskId) {
    try {
        const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${KIE_API_KEY}`
            }
        });
        const data = await response.json();
        console.log(`FULL response for ${taskId}:`, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(e);
    }
}

async function main() {
    for (const task of TASKS) {
        await queryTask(task);
        console.log("------------------");
    }
}

main();
