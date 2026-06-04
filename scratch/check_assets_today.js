require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    try {
        console.log("=== Querying assets created today ===");
        const today = new Date();
        today.setHours(0,0,0,0);
        const { data: assets, error } = await supabase
            .from('assets')
            .select('id, user_id, type, status, url, created_at, caption')
            .gte('created_at', today.toISOString())
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        console.log(`Found ${assets.length} assets created today:`);
        assets.forEach((a, i) => {
            console.log(`[${i}] ID: ${a.id}`);
            console.log(`    User ID: ${a.user_id}`);
            console.log(`    Type: ${a.type}`);
            console.log(`    Status: ${a.status}`);
            console.log(`    URL: ${a.url}`);
            console.log(`    Created At: ${a.created_at}`);
            console.log(`    Caption: ${a.caption ? a.caption.substring(0, 100) : 'None'}`);
            console.log("-----------------------------------------");
        });
    } catch (e) {
        console.error(e);
    }
}

run();
