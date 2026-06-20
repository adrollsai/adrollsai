const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const userId = "c890a11f-84ce-4592-ab8f-8682927b1a9d"; // Realty Nation

async function run() {
    console.log("=== Querying Realty Nation Video Assets and Tasks ===");
    
    // Fetch recent assets
    const { data: assets, error: assetsErr } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
        
    if (assetsErr) {
        console.error("Assets Error:", assetsErr);
        return;
    }

    console.log(`Found ${assets.length} recent assets:`);
    for (const a of assets) {
        console.log(`- ID: ${a.id}, Type: ${a.type}, Status: ${a.status}, URL: ${a.url}, Caption: ${a.caption}, Created: ${a.created_at}`);
    }

    // Fetch video tasks
    const { data: videoTasks, error: tasksErr } = await supabaseAdmin
        .from('video_tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
        
    if (tasksErr) {
        console.error("Video Tasks Error:", tasksErr);
        return;
    }

    console.log(`\nFound ${videoTasks.length} recent video tasks in the DB:`);
    for (const t of videoTasks) {
        // Let's check if the video task corresponds to one of our user's assets
        const matchesUserAsset = assets.some(a => a.id === t.asset_id);
        if (matchesUserAsset) {
            console.log(`[MATCH] Task ID: ${t.id}, Asset ID: ${t.asset_id}, Index: ${t.current_index}, Status: ${t.status}, Prompts count: ${t.prompts?.length}, Last Task ID: ${t.last_task_id}`);
        }
    }
}

run().catch(console.error);
