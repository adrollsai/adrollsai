require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const assetId = "99ec37c2-901b-4ef2-a0ed-afd10101a321";

async function run() {
    try {
        console.log("=== Querying Asset Details for:", assetId);
        const { data: asset, error } = await supabase
            .from('assets')
            .select('*')
            .eq('id', assetId)
            .single();

        if (error) {
            console.error("Error fetching asset:", error);
            return;
        }

        console.log(JSON.stringify(asset, null, 2));
    } catch (e) {
        console.error(e);
    }
}

run();
