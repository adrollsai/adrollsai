const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Dumping Campaigns ===");
    const { data: campaigns, error } = await supabaseAdmin
        .from('campaigns')
        .select('id, user_id, name, status, created_at')
        .limit(50);
    
    if (error) {
        console.error("Error fetching campaigns:", error);
        return;
    }

    console.log(`Found ${campaigns.length} total campaigns.`);
    campaigns.forEach(c => {
        console.log(`Campaign: ${c.name} | ID: ${c.id} | User ID: ${c.user_id} | Status: ${c.status}`);
    });
}

run().catch(console.error);
