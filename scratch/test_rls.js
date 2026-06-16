const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create admin client to get the session token for the admin user
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const adminUserId = "bc63c065-9bcc-4793-bedc-f0960406425b";
    const targetUserId = "c890a11f-84ce-4592-ab8f-8682927b1a9d"; // Realty Nation

    // Fetch admin token / check user
    console.log("Fetching admin user details...");
    const { data: ownProfile, error: err } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', adminUserId)
        .single();
    console.log("Admin role:", ownProfile?.role);

    // Let's check if the admin client can fetch the target profile
    const { data: targetProfileAdmin } = await supabaseAdmin
        .from('profiles')
        .select('business_name, contact_number')
        .eq('id', targetUserId)
        .single();
    console.log("Admin client fetched targetProfile:", targetProfileAdmin);
}

run().catch(console.error);
