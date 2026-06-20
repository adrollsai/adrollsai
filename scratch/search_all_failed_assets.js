const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Searching for all Failed Assets ===");
    const { data: assets, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('status', 'Failed');

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${assets.length} failed assets:`);
    for (const a of assets) {
        console.log(`- ID: ${a.id} | User: ${a.user_id} | Type: ${a.type} | Created: ${a.created_at} | Url: ${a.url}`);
        console.log(`  Caption: ${a.caption}`);
        console.log(`  Metadata:`, JSON.stringify(a.metadata, null, 2));
        console.log("------------------------");
    }
}

run().catch(console.error);
