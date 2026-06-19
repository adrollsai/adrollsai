const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Fetching task details for asset 9d9aafe3-e5b4-4e4d-9ee5-97d1dfc28e72...");
    const { data: tasks, error } = await supabase
        .from('video_tasks')
        .select('*')
        .eq('asset_id', '9d9aafe3-e5b4-4e4d-9ee5-97d1dfc28e72');

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${tasks.length} tasks:`);
    tasks.forEach((t, i) => {
        console.log(`Task ${i}:`);
        console.log(`  ID: ${t.id}`);
        console.log(`  Index: ${t.current_index}`);
        console.log(`  Status: ${t.status}`);
        console.log(`  Last Task ID: ${t.last_task_id}`);
        console.log(`  Aspect Ratio: ${t.aspect_ratio}`);
        console.log(`  Final Caption: ${t.final_caption}`);
        console.log(`  Prompts (length ${t.prompts?.length}):`);
        t.prompts?.forEach((p, pi) => {
            console.log(`    [Prompt ${pi}]: ${p.substring(0, 100)}...`);
        });
    });
}

run();
