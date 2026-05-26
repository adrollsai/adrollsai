const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = "42d2e0c5-4fe6-4738-8a9f-63f09be01f12";
    console.log(`=== ASSETS FOR GNR HOMES (${userId}) ===`);
    const { data: assets } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    console.log(JSON.stringify(assets, null, 2));

    console.log("\n=== VIDEO TASKS IN DB ===");
    const { data: tasks } = await supabaseAdmin.from('video_tasks').select('*');
    console.log(JSON.stringify(tasks, null, 2));
}

run().catch(console.error);
