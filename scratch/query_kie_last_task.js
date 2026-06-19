require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const KIE_API_KEY = process.env.KIE_API_KEY;
const TASK_ID = "c02daa1892898d3755fc182689d55ed2";

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
        console.log(`Response for ${taskId}:`, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`Error querying task ${taskId}:`, e);
    }
}

async function main() {
    if (!KIE_API_KEY) {
        console.error("KIE_API_KEY is not defined in the environment.");
        return;
    }
    await queryTask(TASK_ID);
}

main();
