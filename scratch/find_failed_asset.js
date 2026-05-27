const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function findFailedAssets() {
    const targetUserId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
    
    console.log("Fetching recent assets for subaccount...");
    const { data: assets, error: assetErr } = await supabase
        .from('assets')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(10);

    if (assetErr) {
        console.error("Error fetching assets:", assetErr);
        return;
    }

    console.log("=== Recent Assets ===");
    assets.forEach(a => {
        console.log(`- ID: ${a.id} | Type: ${a.type} | Status: ${a.status} | Created: ${a.created_at} | Url: ${a.url}`);
        if (a.metadata) {
            console.log(`  Metadata:`, JSON.stringify(a.metadata, null, 2));
        }
    });

    console.log("\nFetching recent video tasks...");
    const { data: tasks, error: taskErr } = await supabase
        .from('video_tasks')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(10);

    if (taskErr) {
        console.error("Error fetching video tasks:", taskErr);
        return;
    }

    console.log("=== Recent Video Tasks ===");
    tasks.forEach(t => {
        console.log(`- ID: ${t.id} | AssetID: ${t.asset_id} | Status: ${t.status} | TaskID: ${t.last_task_id} | Created: ${t.created_at}`);
    });
}

findFailedAssets();
