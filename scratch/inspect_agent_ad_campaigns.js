const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Checking agent_ad_campaigns ===");
    const { data: campaigns, error } = await supabaseAdmin
        .from('agent_ad_campaigns')
        .select('*')
        .limit(20);
    
    if (error) {
        console.error("Error fetching agent_ad_campaigns:", error);
        return;
    }

    console.log(`Found ${campaigns.length} agent_ad_campaigns.`);
    campaigns.forEach(c => {
        console.log(`Campaign: ${c.name} | ID: ${c.id} | User ID: ${c.user_id} | Status: ${c.status}`);
    });
}

run().catch(console.error);
