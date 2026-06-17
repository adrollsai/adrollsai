const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== 1. FINDING PROFILES ASSOCIATED WITH ADROLLS ===");
    const { data: profiles, error: pError } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, pixel_id, custom_domain');
        
    if (pError) {
        console.error("Profiles Query Error:", pError);
    } else {
        const adrollsProfiles = profiles.filter(p => 
            (p.email && p.email.includes('adrolls')) || 
            (p.business_name && p.business_name.includes('Adrolls')) || 
            (p.custom_domain && p.custom_domain.includes('adrolls')) ||
            (p.email && p.email.includes('rchopra'))
        );
        console.log("Found matching profiles:", JSON.stringify(adrollsProfiles, null, 2));
    }

    console.log("\n=== 2. FINDING ALL LANDING PAGES FOR rchopra489@gmail.com ===");
    const { data: pages, error: pageError } = await supabaseAdmin
        .from('landing_pages')
        .select('id, user_id, slug, title, product_name, pixel_id')
        .eq('user_id', 'bc63c065-9bcc-4793-bedc-f0960406425b');

    if (pageError) {
        console.error("Landing Pages Query Error:", pageError);
    } else {
        console.log("Found landing pages:", JSON.stringify(pages, null, 2));
    }
}

run().catch(console.error);
