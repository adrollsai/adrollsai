const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const assetId = 'e10fa0af-1599-40fb-89aa-0d194e9adcef';
    console.log(`Querying task lists for Asset ID: ${assetId}`);

    const { data: tasks, error: tasksErr } = await supabase
        .from('video_tasks')
        .select('id, current_index, last_task_id, last_successful_task_id, status')
        .eq('asset_id', assetId)
        .order('current_index', { ascending: true });

    if (tasksErr) {
        console.error("Error:", tasksErr);
        return;
    }

    tasks.forEach(t => {
        console.log(`Index: ${t.current_index} | Task ID: ${t.last_task_id} | Status: ${t.status} | URL: ${t.last_successful_task_id}`);
    });
}

run();
