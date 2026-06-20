require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const KIE_API_KEY = process.env.KIE_API_KEY;
const TASK_ID = "c02daa1892898d3755fc182689d55ed2";

async function run() {
    const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${TASK_ID}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${KIE_API_KEY}`
        }
    });
    const data = await response.json();
    console.log("=== Param Details ===");
    if (data.data && data.data.param) {
        try {
            const parsedParam = JSON.parse(data.data.param);
            console.log(JSON.stringify(parsedParam, null, 2));
        } catch (e) {
            console.log("Raw param:", data.data.param);
        }
    } else {
        console.log("No param found in response:", data);
    }
}

run().catch(console.error);
