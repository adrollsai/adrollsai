const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const ids = [
        'bc63c065-9bcc-4793-bedc-f0960406425b',
        'c890a11f-84ce-4592-ab8f-8682927b1a9d',
        '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2',
        '29937131-1975-4c5f-9b78-e5b28f918d32'
    ];
    console.log("Fetching profiles for UNLIMITED_USERS IDs...");
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, subscription_plan')
        .in('id', ids);
        
    if (error) {
        console.error("Query Error:", error);
        return;
    }

    console.log(JSON.stringify(profiles, null, 2));
}

run().catch(console.error);
