const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== RECENT ASSETS ===");
    const { data: assets, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
    
    if (error) {
        console.error("Error fetching assets:", error);
        return;
    }
    
    assets.forEach(asset => {
        console.log(`ID: ${asset.id}`);
        console.log(`  User ID: ${asset.user_id}`);
        console.log(`  Type: ${asset.type}`);
        console.log(`  Status: ${asset.status}`);
        console.log(`  URL: ${asset.url}`);
        console.log(`  Caption: ${asset.caption}`);
        console.log(`  Created At: ${asset.created_at}`);
        console.log("-----------------------------------------");
    });
}

run().catch(console.error);
