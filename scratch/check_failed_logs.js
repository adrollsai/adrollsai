require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFailedTasks() {
    try {
        console.log("Fetching recent tasks that might have failed or are processing...");
        const { data: tasks, error } = await supabase
            .from('video_tasks')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) {
            console.error("Supabase Error:", error);
            return;
        }

        tasks.forEach(t => {
            console.log("=========================================");
            console.log(`Task ID: ${t.id} | Index: ${t.current_index}`);
            console.log(`Status: ${t.status}`);
            console.log(`Last Error: ${t.last_error}`);
            console.log(`Kie Task ID: ${t.last_task_id}`);
            console.log(`Kie Successful ID: ${t.last_successful_task_id}`);
        });

        console.log("\nFetching recent assets...");
        const { data: assets, error: assetErr } = await supabase
            .from('assets')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);

        if (assetErr) {
            console.error("Asset fetch error:", assetErr);
            return;
        }

        assets.forEach(a => {
            console.log("-----------------------------------------");
            console.log(`Asset ID: ${a.id}`);
            console.log(`Status: ${a.status}`);
            console.log(`URL: ${a.url}`);
            console.log(`Caption: ${a.caption}`);
            console.log(`Created At: ${a.created_at}`);
        });

    } catch (e) {
        console.error("Error:", e);
    }
}

checkFailedTasks();
