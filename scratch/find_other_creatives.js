const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== CLIENT PROFILES ===");
    const { data: profiles, error: pErr } = await supabaseAdmin.from('profiles').select('id, email, business_name, role');
    if (pErr) {
        console.error("Profiles error:", pErr);
        return;
    }
    
    profiles.forEach(p => {
        console.log(`Profile: ${p.business_name} | Email: ${p.email} | ID: ${p.id} | Role: ${p.role}`);
    });

    console.log("\n=== ALL ASSETS FOR NON-CHOPRA PROFILES ===");
    // Filter out bc63c065-9bcc-4793-bedc-f0960406425b (rchopra)
    const { data: assets, error: aErr } = await supabaseAdmin
        .from('assets')
        .select('*')
        .neq('user_id', 'bc63c065-9bcc-4793-bedc-f0960406425b')
        .order('created_at', { ascending: false });

    if (aErr) {
        console.error("Assets error:", aErr);
        return;
    }

    console.log(`Found ${assets.length} assets.`);
    assets.forEach(asset => {
        // Look for image/graphic assets
        console.log(`Asset ID: ${asset.id} | User ID: ${asset.user_id} | Type: ${asset.type} | URL: ${asset.url || asset.image_url}`);
    });
}

run().catch(console.error);
