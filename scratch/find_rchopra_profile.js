require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    try {
        console.log("Searching for profiles with email/name rchopra...");
        // Let's select all profiles and filter by email if it exists, or look at profiles
        const { data: profiles, error } = await supabase
            .from('profiles')
            .select('*');

        if (error) {
            console.error("Error:", error);
            return;
        }

        console.log(`Fetched ${profiles.length} total profiles.`);
        profiles.forEach(p => {
            if (p.email && p.email.includes('rchopra') || p.business_name && p.business_name.includes('rchopra') || p.id === "bc63c065-9bcc-4793-bedc-f0960406425b") {
                console.log("-----------------------------------------");
                console.log(`ID: ${p.id}`);
                console.log(`Email: ${p.email}`);
                console.log(`Role: ${p.role}`);
                console.log(`Character URL: ${p.character_url}`);
                console.log(`Business Name: ${p.business_name}`);
            }
        });
    } catch (e) {
        console.error(e);
    }
}

run();
