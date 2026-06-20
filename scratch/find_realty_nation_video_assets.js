const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const userId = "c890a11f-84ce-4592-ab8f-8682927b1a9d"; // Realty Nation

async function run() {
    console.log("=== Fetching all Realty Nation Video Assets ===");
    const { data: assets, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('user_id', userId)
        .eq('type', 'video')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${assets.length} video assets:`);
    for (const a of assets) {
        console.log(`- ID: ${a.id}`);
        console.log(`  Status: ${a.status}`);
        console.log(`  URL: ${a.url}`);
        console.log(`  Caption: ${a.caption}`);
        console.log(`  Created: ${a.created_at}`);
        console.log(`  Metadata:`, JSON.stringify(a.metadata, null, 2));
        console.log("------------------------");
    }
}

run().catch(console.error);
