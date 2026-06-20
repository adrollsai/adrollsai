require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const KIE_API_KEY = process.env.KIE_API_KEY;
const TASK_IDS = [
    "c02daa1892898d3755fc182689d55ed2",
    "7a7cacfa21eb77f146cc56cccf7bf3ac",
    "e1f2eadf9e83f584490016f3b6b19de5"
];

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
        console.error("Error:", e);
    }
}

async function main() {
    for (const id of TASK_IDS) {
        await queryTask(id);
        console.log("-----------------------------------------");
    }
}

main();
