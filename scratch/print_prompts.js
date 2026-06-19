const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: tasks, error } = await supabase
        .from('video_tasks')
        .select('*')
        .eq('asset_id', '9d9aafe3-e5b4-4e4d-9ee5-97d1dfc28e72')
        .limit(1);

    if (error || !tasks || tasks.length === 0) {
        console.error("Error or no tasks:", error);
        return;
    }

    const task = tasks[0];
    console.log("PROMPTS:");
    task.prompts.forEach((p, i) => {
        console.log(`\n================ PROMPT ${i} ================`);
        console.log(p);
    });
}

run();
