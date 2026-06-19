const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Searching for GNR Homes profile...");
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, custom_domain, role');
        
    if (error) {
        console.error("Query Error:", error);
    } else {
        const matches = profiles.filter(p => 
            (p.business_name && p.business_name.toLowerCase().includes('gnr')) ||
            (p.email && p.email.toLowerCase().includes('gnr'))
        );
        console.log("Matches found:", JSON.stringify(matches, null, 2));
    }
}

run().catch(console.error);
