const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Searching for videoad or recent video assets ===");
    const { data: assets, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error("Error:", error);
        return;
    }

    const filtered = assets.filter(a => 
        (a.url && a.url.includes('videoad')) || 
        a.type === 'video'
    );

    console.log(`Found ${filtered.length} matching assets in recent 100:`);
    for (const a of filtered) {
        console.log(`- ID: ${a.id}`);
        console.log(`  User ID: ${a.user_id}`);
        console.log(`  Type: ${a.type}`);
        console.log(`  Status: ${a.status}`);
        console.log(`  URL: ${a.url}`);
        console.log(`  Caption: ${a.caption}`);
        console.log(`  Created: ${a.created_at}`);
        console.log(`  Metadata:`, JSON.stringify(a.metadata, null, 2));
        console.log("------------------------");
    }
}

run().catch(console.error);
