require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = "9bbf6e51-283e-48d1-bbb4-8dc546cc74b2";

async function run() {
    try {
        console.log("=== Listing recent video assets for subaccount", userId);
        const { data: assets, error } = await supabase
            .from('assets')
            .select('id, status, type, url, created_at, kie_task_id, metadata')
            .eq('user_id', userId)
            .eq('type', 'video')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error("Error fetching assets:", error);
            return;
        }

        assets.forEach((a, i) => {
            console.log(`[${i}] ID: ${a.id}`);
            console.log(`    Status: ${a.status}`);
            console.log(`    URL: ${a.url ? a.url.substring(0, 100) : 'None'}`);
            console.log(`    Kie Task ID: ${a.kie_task_id}`);
            console.log(`    Created At: ${a.created_at}`);
            console.log(`    Error in Metadata: ${a.metadata?.error || 'None'}`);
            console.log("-----------------------------------------");
        });
    } catch (e) {
        console.error(e);
    }
}

run();
