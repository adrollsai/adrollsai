const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Fetching recent video tasks...");
    const { data: tasks, error } = await supabase
        .from('video_tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

    if (error) {
        console.error("Error:", error);
        return;
    }

    tasks.forEach((t, i) => {
        console.log(`[${i}] ID: ${t.id} | Asset ID: ${t.asset_id} | Index: ${t.current_index} | Status: ${t.status} | Task ID: ${t.last_task_id} | Created: ${t.created_at}`);
    });
}

run();
