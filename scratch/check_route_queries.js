const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const user_id = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
    const slug = 'homeland-regalia-4166';
    
    console.log(`=== RUNNING DIAGNOSTICS FOR: user_id=${user_id}, slug=${slug} ===`);
    
    // 1. Resolve business profile
    let profileQuery = supabaseAdmin.from('profiles').select('id, business_name, logo_url, custom_domain, pixel_id')
    if (user_id.includes('.')) {
        profileQuery = profileQuery.eq('custom_domain', user_id)
    } else {
        profileQuery = profileQuery.eq('id', user_id)
    }
    const { data: profile, error: profErr } = await profileQuery.maybeSingle()
    
    if (profErr) {
        console.error("Profile Query Error:", profErr);
    } else {
        console.log("Profile resolved successfully:", profile);
    }
    
    if (!profile) {
        console.log("❌ Profile not found!");
        return;
    }
    
    // 2. Resolve landing page listing
    const { data: page, error: pageErr } = await supabaseAdmin
        .from('landing_pages')
        .select(`
            id,
            title,
            product_name,
            form_id
        `)
        .eq('user_id', profile.id)
        .eq('slug', slug)
        .maybeSingle()
        
    if (pageErr) {
        console.error("Landing Page Query Error:", pageErr);
    } else {
        console.log("Landing page resolved successfully:", page);
    }
    
    if (!page) {
        console.log("❌ Landing page not found in DB!");
    } else {
        console.log("✅ LANDING PAGE EXISTS AND IS OK!");
    }
}

run().catch(console.error);
