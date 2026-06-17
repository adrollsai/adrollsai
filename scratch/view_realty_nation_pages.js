const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    // Realty Nation sub-account ID: c890a11f-84ce-4592-ab8f-8682927b1a9d
    const subAccountId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d';
    
    console.log("=== Fetching Realty Nation Profile ===");
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', subAccountId)
        .single();
    console.log("Profile Pixel ID:", profile?.pixel_id);
    console.log("Profile Name:", profile?.business_name);

    console.log("\n=== Fetching Landing Pages ===");
    const { data: pages } = await supabaseAdmin
        .from('landing_pages')
        .select('id, slug, product_name, pixel_id, html_content')
        .eq('user_id', subAccountId);
    
    if (!pages || pages.length === 0) {
        console.log("No pages found.");
    } else {
        pages.forEach(p => {
            console.log(`- Page ID: ${p.id}, Slug: ${p.slug}, Product: ${p.product_name}, Pixel ID in DB: ${p.pixel_id}`);
            
            // Check if there is a hardcoded fbq('init', ...) or similar in html_content
            const hasFbqInit = p.html_content.includes("fbq('init'");
            const matches = p.html_content.match(/fbq\('init',\s*'([0-9]+)'\)/g);
            console.log(`  Contains hardcoded fbq('init'): ${hasFbqInit}`);
            if (matches) {
                console.log(`  Found fbq init matches: ${JSON.stringify(matches)}`);
            }
        });
    }
}

run().catch(console.error);
