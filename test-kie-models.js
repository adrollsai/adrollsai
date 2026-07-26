const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

// Dump ALL models to see exact IDs
async function dumpAll() {
    const res = await fetch('https://api.kie.ai/api/v1/models', {
        headers: { 'Authorization': 'Bearer ' + key }
    });
    const json = await res.json();
    console.log("Status:", res.status);
    console.log("Full response:", JSON.stringify(json, null, 2).substring(0, 5000));
}

dumpAll().catch(console.error);
