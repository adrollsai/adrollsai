const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/video_tasks?select=*`, {
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json'
        }
    });
    const tasks = await res.json();
    console.log('ALL VIDEO TASKS in DB:', tasks);
}

main().catch(console.error);
