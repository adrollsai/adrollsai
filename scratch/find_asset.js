const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const ids = ["33fb42c1-9015-4217-b9d9-b0e70893ee29", "edbe022d-854c-444b-93d0-09e300cb8cfd"];
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
