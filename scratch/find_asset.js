const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const ids = ["5049ca13-bd60-4c40-af90-4fff1d02fb0a", "96ba7f32-99bd-43e5-9ff2-14249d1a2718"];
    console.log("=== SEARCHING FOR ASSETS ===");
    for (const id of ids) {
        const { data: asset, error } = await supabaseAdmin
            .from('assets')
            .select('*')
            .eq('id', id)
            .single();
        
        if (error) {
            console.error(`Error fetching asset ${id}:`, error.message);
            continue;
        }
        
        console.log(`ID: ${asset.id}`);
        console.log(`  User ID: ${asset.user_id}`);
        console.log(`  Type: ${asset.type}`);
        console.log(`  Status: ${asset.status}`);
        console.log(`  URL: ${asset.url}`);
        console.log(`  Caption: ${asset.caption}`);
        console.log(`  Created At: ${asset.created_at}`);
        console.log("-----------------------------------------");
    }
}

run().catch(console.error);
