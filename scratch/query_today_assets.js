const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== TODAY'S ASSETS ===");
    const today = new Date().toISOString().split('T')[0]; // "2026-05-26"
    console.log("Date:", today);
    const { data: assets, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .gte('created_at', today)
        .order('created_at', { ascending: false });
    
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
