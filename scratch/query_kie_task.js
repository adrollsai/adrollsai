const KIE_API_KEY = process.env.KIE_API_KEY;

const TASK_1 = "7a7cacfa21eb77f146cc56cccf7bf3ac";
const TASK_2 = "e1f2eadf9e83f584490016f3b6b19de5";

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
    await queryTask(TASK_1);
    console.log("\n-----------------------------------\n");
    await queryTask(TASK_2);
}

main();
