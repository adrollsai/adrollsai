require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const userId = 'fd337d26-5919-42c1-a805-577fda7b93bf';
    
    // Check all assets for this user
    console.log("=== ALL ASSETS FOR USER ===");
    const { data: assets, error: assetsErr } = await supabase
        .from('assets')
        .select('id, status, url, type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(15);

    if (assetsErr) {
        console.error("Error:", assetsErr);
        return;
    }

    assets.forEach(a => {
        const urlShort = a.url ? a.url.substring(0, 90) + '...' : 'None';
        console.log(`ID: ${a.id} | Status: ${a.status} | Type: ${a.type} | Created: ${a.created_at}`);
        console.log(`  URL: ${urlShort}`);
    });

    // Check if the specific video URL is reachable
    console.log("\n=== CHECKING VIDEO URL ACCESSIBILITY ===");
    const targetAsset = assets.find(a => a.id === 'a2167697-392d-46a2-89a4-28f7896c2d3a');
    if (targetAsset && targetAsset.url) {
        try {
            const resp = await fetch(targetAsset.url, { method: 'HEAD' });
            console.log(`URL Status: ${resp.status} ${resp.statusText}`);
            console.log(`Content-Type: ${resp.headers.get('content-type')}`);
            console.log(`Content-Length: ${resp.headers.get('content-length')}`);
        } catch (e) {
            console.error("Failed to reach URL:", e.message);
        }
    }

    // Check for any remaining video_tasks for this user
    console.log("\n=== VIDEO TASKS FOR USER ===");
    const { data: tasks, error: tasksErr } = await supabase
        .from('video_tasks')
        .select('*')
        .eq('user_id', userId);

    if (tasksErr) {
        console.error("Error:", tasksErr);
    } else if (tasks.length === 0) {
        console.log("No video tasks found.");
    } else {
        tasks.forEach(t => {
            console.log(`Task ID: ${t.id} | Asset: ${t.asset_id} | Status: ${t.status} | Index: ${t.current_index}`);
        });
    }
}

run().catch(console.error);
