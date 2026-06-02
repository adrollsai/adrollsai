const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== LISTING ALL CUSTOM DOMAINS ===");
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, custom_domain, role')
        .not('custom_domain', 'is', null);
        
    if (error) {
        console.error("Error:", error);
    } else {
        console.log(JSON.stringify(profiles, null, 2));
    }
}

run().catch(console.error);
