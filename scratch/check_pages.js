const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== LISTING ALL LANDING PAGES ===");
    const { data: pages, error } = await supabaseAdmin
        .from('landing_pages')
        .select('id, user_id, slug, title, product_name, form_id');
        
    if (error) {
        console.error("Error:", error);
    } else {
        console.log(JSON.stringify(pages, null, 2));
    }
}

run().catch(console.error);
