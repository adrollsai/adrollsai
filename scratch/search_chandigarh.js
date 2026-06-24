const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";
const GNR_HOMES_USER_ID = "42d2e0c5-4fe6-4738-8a9f-63f09be01f12";

async function run() {
    const { data: p } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token')
        .eq('id', GNR_HOMES_USER_ID)
        .single();

    const token = p.facebook_token;

    console.log("Searching Meta for Chandigarh...");
    const searchRes = await fetch(`${FB_MARKETING_URL}/search?type=adgeolocation&q=Chandigarh&access_token=${token}`);
    const searchData = await searchRes.json();
    const results = searchData.data || [];
    
    console.log(`Found ${results.length} locations matching "Chandigarh":`);
    results.slice(0, 10).forEach(r => {
        console.log(`- Name: ${r.name} | Key: ${r.key} | Type: ${r.type} | Country: ${r.country_code} | Region ID: ${r.region_id}`);
    });

    // Check information about key "2076935" specifically
    console.log("\nChecking details for key 2076935...");
    const keyRes = await fetch(`${FB_MARKETING_URL}/search?type=adgeolocation&q=2076935&access_token=${token}`);
    const keyData = await keyRes.json();
    console.log("Details:", JSON.stringify(keyData.data, null, 2));
}

run().catch(console.error);
