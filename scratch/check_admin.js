const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    console.log("=== LANDING PAGES ===");
    const { data: pages } = await supabaseAdmin
        .from('landing_pages')
        .select('id, slug, title, product_name, form_id, booking_enabled')
        .eq('user_id', userId);
    console.log(pages);
}

run().catch(console.error);
