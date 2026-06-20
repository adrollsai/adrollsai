const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const userId = "c890a11f-84ce-4592-ab8f-8682927b1a9d"; // Realty Nation

async function run() {
    console.log("=== Querying Realty Nation Landing Pages ===");
    const { data: pages, error } = await supabaseAdmin
        .from('landing_pages')
        .select('*')
        .eq('user_id', userId);

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${pages.length} pages:`);
    pages.forEach((p, idx) => {
        console.log(`\n--- Page ${idx + 1}: ${p.slug} ---`);
        console.log(`ID: ${p.id}`);
        console.log(`Product Name: ${p.product_name}`);
        console.log(`Created: ${p.created_at}`);
        console.log(`Video URL: ${p.video_url}`);
        
        // Print keys of page to see what fields exist
        console.log(`Fields:`, Object.keys(p));
        
        // Check for any field containing script or video
        for (const [k, v] of Object.entries(p)) {
            if (k.includes('script') || k.includes('video') || k.includes('config') || k.includes('prompt')) {
                console.log(`  ${k}:`, typeof v === 'object' ? JSON.stringify(v, null, 2) : v);
            }
        }
    });
}

run().catch(console.error);
