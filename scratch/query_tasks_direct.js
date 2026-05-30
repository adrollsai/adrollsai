require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    try {
        const { data, error } = await supabase.from('video_tasks').select('*');
        if (error) {
            console.error("Error:", error);
            return;
        }
        console.log(`Fetched ${data.length} tasks.`);
        data.forEach(t => {
            console.log("-----------------------");
            console.log("ID:", t.id);
            console.log("Status:", t.status);
            console.log("Last Task ID:", t.last_task_id);
            console.log("Last Successful ID:", t.last_successful_task_id);
            console.log("Last Error:", t.last_error);
        });
    } catch (e) {
        console.error(e);
    }
}

run();
