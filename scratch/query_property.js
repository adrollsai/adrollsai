require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const propertyId = "962a1c2f-6f47-49e5-9c8c-3bd0ac491bb3";

async function run() {
    try {
        console.log("=== Querying Property Details for:", propertyId);
        const { data: prop, error } = await supabase
            .from('properties')
            .select('*')
            .eq('id', propertyId)
            .single();

        if (error) {
            console.error("Error fetching property:", error);
            return;
        }

        console.log(JSON.stringify(prop, null, 2));
    } catch (e) {
        console.error(e);
    }
}

run();
