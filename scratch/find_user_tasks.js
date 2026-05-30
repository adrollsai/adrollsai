require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRecentTasks() {
    try {
        console.log("Fetching recent tasks...");
        const { data: tasks, error } = await supabase
            .from('video_tasks')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) {
            console.error("Supabase Error:", error);
            return;
        }

        console.log(`Found ${tasks.length} recent tasks.`);
        tasks.forEach(t => {
            console.log("=========================================");
            console.log(`Task ID: ${t.id}`);
            console.log(`Asset ID: ${t.asset_id}`);
            console.log(`Status: ${t.status}`);
            console.log(`Last Task ID (kie.ai): ${t.last_task_id}`);
            console.log(`Last Successful Task ID (avatar): ${t.last_successful_task_id}`);
            console.log(`Prompts:`, JSON.stringify(t.prompts, null, 2));
            console.log(`Created At: ${t.created_at}`);
            console.log(`Updated At: ${t.updated_at}`);
        });
    } catch (e) {
        console.error("Error:", e);
    }
}

checkRecentTasks();
