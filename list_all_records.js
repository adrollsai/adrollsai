const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== ALL VIDEO TASKS ===");
    const { data: tasks } = await supabaseAdmin.from('video_tasks').select('*');
    console.log(JSON.stringify(tasks, null, 2));

    console.log("\n=== RECENT PROCESSING/RENDERING ASSETS ===");
    const { data: assets } = await supabaseAdmin.from('assets').select('*').in('status', ['Processing', 'Rendering', 'Failed']).order('created_at', { ascending: false }).limit(5);
    console.log(JSON.stringify(assets, null, 2));
}

run().catch(console.error);
