const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== PROFILES ===");
    const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, business_name, brand_color, custom_domain');
    if (pErr) console.error(pErr);
    else console.log(JSON.stringify(profiles, null, 2));

    console.log("\n=== LANDING PAGES ===");
    const { data: pages, error: lErr } = await supabase.from('landing_pages').select('id, slug, product_name, form_id, updated_at').order('updated_at', { ascending: false }).limit(5);
    if (lErr) console.error(lErr);
    else console.log(JSON.stringify(pages, null, 2));
}

run().catch(console.error);
