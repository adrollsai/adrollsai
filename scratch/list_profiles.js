const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Listing all Profiles ===");
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, role, agency_id, parent_id');

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${profiles.length} profiles:`);
    profiles.forEach(p => {
        console.log(`- ID: ${p.id} | Name: ${p.business_name} | Role: ${p.role} | Agency: ${p.agency_id} | Parent: ${p.parent_id}`);
    });
}

run().catch(console.error);
