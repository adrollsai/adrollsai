const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Finding Domain Mappings ===");
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, pixel_id, custom_domain, whitelabel_domain, whitelabel_verify_status');
        
    if (error) {
        console.error("Error fetching profiles:", error);
        return;
    }

    const matched = profiles.filter(p => 
        (p.custom_domain && p.custom_domain.includes('adrolls')) || 
        (p.whitelabel_domain && p.whitelabel_domain.includes('adrolls'))
    );

    console.log("Matched profiles with adrolls domain:", JSON.stringify(matched, null, 2));

    console.log("\nAll profiles with custom or whitelabel domains:");
    profiles.forEach(p => {
        if (p.custom_domain || p.whitelabel_domain) {
            console.log(`- Profile: ${p.business_name} (${p.email}), custom_domain: ${p.custom_domain}, whitelabel_domain: ${p.whitelabel_domain}, pixel_id: ${p.pixel_id}`);
        }
    });
}

run().catch(console.error);
