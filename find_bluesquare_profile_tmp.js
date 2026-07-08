const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== SEARCHING FOR BLUESQUARE PROFILES ===");
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, role')
        .or('business_name.ilike.%bluesquare%,email.ilike.%bluesquare%');

    if (error) {
        console.error("Query failed:", error);
        return;
    }

    if (!profiles || profiles.length === 0) {
        console.log("No profiles found matching 'bluesquare'. Listing first 5 profiles instead:");
        const { data: first5 } = await supabaseAdmin.from('profiles').select('id, email, business_name').limit(5);
        console.log(JSON.stringify(first5, null, 2));
        return;
    }

    console.log("Matched profiles:");
    console.log(JSON.stringify(profiles, null, 2));
}

run().catch(console.error);
