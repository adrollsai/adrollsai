require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAsset() {
    try {
        const { data: asset, error } = await supabase
            .from('assets')
            .select('*')
            .eq('id', 'a2167697-392d-46a2-89a4-28f7896c2d3a')
            .single();

        if (error) {
            console.error("Supabase Error:", error);
            return;
        }

        console.log("=== Asset details ===");
        console.log(JSON.stringify(asset, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
}

checkAsset();
