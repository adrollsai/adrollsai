const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const userId = "c890a11f-84ce-4592-ab8f-8682927b1a9d"; // Realty Nation

async function run() {
    console.log("=== Querying Realty Nation Properties ===");
    const { data: properties, error } = await supabaseAdmin
        .from('properties')
        .select('*')
        .eq('user_id', userId);

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${properties.length} properties:`);
    properties.forEach((p, idx) => {
        console.log(`\n--- Property ${idx + 1}: ${p.title} ---`);
        console.log(`ID: ${p.id}`);
        console.log(`Address: ${p.address}`);
        console.log(`Created: ${p.created_at}`);
        console.log(`Images length: ${p.images?.length}`);
        
        // Print all keys
        console.log(`Fields:`, Object.keys(p));
        
        // Check for fields containing script or config or video
        for (const [k, v] of Object.entries(p)) {
            if (k.includes('script') || k.includes('video') || k.includes('config') || k.includes('prompt')) {
                console.log(`  ${k}:`, typeof v === 'object' ? JSON.stringify(v, null, 2) : v);
            }
        }
    });
}

run().catch(console.error);
