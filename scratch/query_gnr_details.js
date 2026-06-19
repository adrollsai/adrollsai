const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Querying GNR HOMES profile details...");
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, custom_domain, domain_verify_status, domain_verify_token')
        .eq('id', '42d2e0c5-4fe6-4738-8a9f-63f09be01f12')
        .single();
        
    if (error) {
        console.error("Query Error:", error);
    } else {
        console.log("GNR HOMES profile details:", JSON.stringify(profile, null, 2));
    }
}

run().catch(console.error);
