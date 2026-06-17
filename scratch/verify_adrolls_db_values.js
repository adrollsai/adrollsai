const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com
    
    console.log("=== Fetching Profile Pixel mapping ===");
    const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('id, email, pixel_id')
        .eq('id', userId)
        .single();

    if (profileErr) {
        console.error("Error:", profileErr);
    } else {
        console.log(`Profile: ${profile.email} is set to Pixel: ${profile.pixel_id}`);
    }

    console.log("\n=== Fetching Landing Pages Pixel mapping ===");
    const { data: pages, error: pageErr } = await supabaseAdmin
        .from('landing_pages')
        .select('id, slug, pixel_id')
        .eq('user_id', userId);

    if (pageErr) {
        console.error("Error:", pageErr);
    } else {
        pages.forEach(p => {
            console.log(`Page: ${p.slug} is set to Pixel: ${p.pixel_id}`);
        });
    }
}

run().catch(console.error);
