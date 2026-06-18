const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Fetching Profiles ===");
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, custom_domain');
    
    if (error) {
        console.error("Error fetching profiles:", error);
        return;
    }

    console.log("Profiles found:", profiles.length);
    profiles.forEach(p => {
        console.log(`ID: ${p.id} | Email: ${p.email} | Name: ${p.business_name} | Domain: ${p.custom_domain}`);
    });
}

run().catch(console.error);
