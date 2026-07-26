const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

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

async function main() {
    console.log('=== RECENT ASSETS (last 5, video type) ===');
    const assets = await query('assets', '?type=eq.video&order=created_at.desc&limit=5&select=id,status,url,caption,metadata,created_at,user_id');
    assets.forEach(a => {
        console.log(`ID: ${a.id}`);
        console.log(`  Status: ${a.status}`);
        console.log(`  URL: ${a.url || 'null'}`);
        console.log(`  Created: ${a.created_at}`);
        console.log(`  Metadata: ${JSON.stringify(a.metadata)}`);
        console.log('');
    });

    console.log('=== RECENT VIDEO_TASKS (last 10) ===');
    const tasks = await query('video_tasks', '?order=created_at.desc&limit=10&select=id,status,last_task_id,last_successful_task_id,current_index,video_model,audio_url,retry_count,last_error,asset_id,created_at');
    tasks.forEach(t => {
        console.log(`Task ID: ${t.id}`);
        console.log(`  Asset ID: ${t.asset_id}`);
        console.log(`  Status: ${t.status}`);
        console.log(`  Model: ${t.video_model}`);
        console.log(`  Index: ${t.current_index}`);
        console.log(`  Kie Task ID: ${t.last_task_id}`);
        console.log(`  Result URL: ${t.last_successful_task_id || 'null'}`);
        console.log(`  Audio URL: ${t.audio_url || 'null'}`);
        console.log(`  Retry count: ${t.retry_count}`);
        console.log(`  Error: ${t.last_error || 'none'}`);
        console.log(`  Created: ${t.created_at}`);
        console.log('');
    });
}
main().catch(console.error);
