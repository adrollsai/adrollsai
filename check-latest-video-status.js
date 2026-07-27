const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const KIE_KEY = env.KIE_API_KEY;

async function query(table, params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json'
        }
    });
    return res.json();
}

async function checkKie(taskId) {
    if (!taskId) return null;
    try {
        const res = await fetch('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=' + taskId, {
            headers: { 'Authorization': 'Bearer ' + KIE_KEY }
        });
        return await res.json();
    } catch (e) {
        return { error: e.message };
    }
}

async function main() {
    console.log('=== LATEST ASSETS (Last 3) ===');
    const assets = await query('assets', '?order=created_at.desc&limit=3');
    console.log(JSON.stringify(assets, null, 2));

    if (assets && assets.length > 0) {
        const latestAsset = assets[0];
        console.log(`\n=== VIDEO TASKS FOR LATEST ASSET (${latestAsset.id}) ===`);
        const tasks = await query('video_tasks', `?asset_id=eq.${latestAsset.id}`);
        console.log(`Found ${tasks.length} task(s):`);
        for (const t of tasks) {
            console.log(`Task ID (DB): ${t.id}`);
            console.log(`  Current Index: ${t.current_index}`);
            console.log(`  Kie Task ID: ${t.last_task_id}`);
            console.log(`  DB Status: ${t.status}`);
            console.log(`  Audio URL: ${t.audio_url}`);
            if (t.last_task_id) {
                const kieInfo = await checkKie(t.last_task_id);
                console.log(`  Kie State: ${kieInfo.data?.state || kieInfo.status}`);
                console.log(`  Kie Info:`, JSON.stringify(kieInfo.data, null, 2));
            }
        }
    }
}

main().catch(console.error);
