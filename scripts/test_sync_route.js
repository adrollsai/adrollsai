const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));

async function testSync() {
    console.log("Calling /api/cron/sync-meta-leads...");
    const res = await fetch('http://localhost:3000/api/cron/sync-meta-leads', {
        headers: {
            'Authorization': `Bearer ${env.CRON_SECRET || ''}`
        }
    });
    console.log('Sync HTTP Status:', res.status);
    const data = await res.json();
    console.log('Sync Response:', JSON.stringify(data, null, 2));
}

testSync().catch(console.error);
