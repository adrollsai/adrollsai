const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log("=== testing video_tasks INSERT WITH supabaseAdmin ===");
    try {
        const tempTaskId = '00000000-0000-0000-0000-000000000000';
        const { data, error } = await supabaseAdmin
            .from('video_tasks')
            .insert({
                id: tempTaskId,
                user_id: '2f62a259-f23b-48ee-a920-c436f36eaa4b',
                prompts: ['Test prompt'],
                current_index: 0,
                last_task_id: 'test_task_id',
                aspect_ratio: '9:16',
                status: 'Processing'
            })
            .select();
            
        if (error) {
            console.error("Service role insert failed:", error);
        } else {
            console.log("Service role insert succeeded!", data);
            
            // Clean it up
            const { error: delError } = await supabaseAdmin
                .from('video_tasks')
                .delete()
                .eq('id', tempTaskId);
            
            if (delError) {
                console.error("Service role delete failed:", delError);
            } else {
                console.log("Service role cleanup succeeded!");
            }
        }
    } catch (e) {
        console.error(e);
    }
}

run();
