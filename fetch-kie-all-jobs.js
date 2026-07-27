const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

async function checkEndpoints() {
    const endpoints = [
        'https://api.kie.ai/api/v1/jobs/list?page=1&pageSize=50',
        'https://api.kie.ai/api/v1/jobs/records?page=1&pageSize=50',
        'https://api.kie.ai/api/v1/jobs/history?page=1&pageSize=50',
        'https://api.kie.ai/api/v1/task/list?page=1&pageSize=50',
        'https://api.kie.ai/api/v1/jobs?page=1&size=50',
    ];

    for (const ep of endpoints) {
        try {
            const res = await fetch(ep, { headers: { 'Authorization': 'Bearer ' + key } });
            console.log(`Endpoint: ${ep} => Status: ${res.status}`);
            if (res.status === 200) {
                const json = await res.json();
                console.log(`SUCCESS Result from ${ep}:`);
                console.log(JSON.stringify(json, null, 2).substring(0, 4000));
            }
        } catch (e) {
            console.error(`Error fetching ${ep}:`, e.message);
        }
    }
}

checkEndpoints().catch(console.error);
