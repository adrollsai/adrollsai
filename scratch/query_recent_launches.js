const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userIds = [
        'c890a11f-84ce-4592-ab8f-8682927b1a9d', // Realty Nation
        '42d2e0c5-4fe6-4738-8a9f-63f09be01f12'  // GNR Homes
    ];
    
    console.log("=== Fetching Most Recent 10 Campaigns ===");
    
    const { data: campaigns, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error("Supabase Error:", error);
        return;
    }

    console.log(`Found ${campaigns.length} campaigns created today:`);
    campaigns.forEach((c) => {
        console.log(`- Campaign: ${c.name}`);
        console.log(`  Created At: ${c.created_at}`);
        console.log(`  Meta ID: ${c.meta_campaign_id}`);
        console.log(`  User ID: ${c.user_id}`);
        console.log(`  Status: ${c.status}`);
        console.log(`  Objective: ${c.objective || 'N/A'}`);
    });
}

run().catch(console.error);
