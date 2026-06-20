const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const userId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d'; // Realty Nation

async function run() {
    console.log("=== Fetching Realty Nation campaigns from DB ===");
    const { data: campaigns, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('user_id', userId);

    if (error) {
        console.error("Supabase error:", error);
        return;
    }

    console.log(`Found ${campaigns.length} campaigns:`);
    campaigns.forEach((c, idx) => {
        console.log(`[Campaign ${idx + 1}]`);
        console.log("  ID:", c.id);
        console.log("  Name:", c.name);
        console.log("  Meta Campaign ID:", c.meta_campaign_id);
        console.log("  Status:", c.status);
    });
}

run();
