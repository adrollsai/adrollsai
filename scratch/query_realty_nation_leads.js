const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Fetching Realty Nation facebook credentials ===");
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('ad_account_id, facebook_token, selected_page_token')
        .eq('id', 'c890a11f-84ce-4592-ab8f-8682927b1a9d')
        .single();

    if (error) {
        console.error(error);
        return;
    }

    const { ad_account_id, facebook_token, selected_page_token } = profile;
    if (!ad_account_id || !facebook_token) {
        console.error("Ad Account ID or Facebook Token is missing!");
        return;
    }

    console.log(`Ad Account: ${ad_account_id}`);
    
    // 1. Fetch campaigns from Facebook
    const url = `https://graph.facebook.com/v19.0/${ad_account_id}/campaigns?fields=id,name,status,effective_status,created_time&access_token=${facebook_token}`;
    console.log("Querying campaigns on Facebook...");
    try {
        const res = await fetch(url);
        const json = await res.json();
        console.log("\n=== Meta Campaigns Result ===");
        if (json.data) {
            console.log(`Found ${json.data.length} campaigns on Facebook:`);
            json.data.forEach(c => {
                console.log(`- ID: ${c.id} | Name: ${c.name} | Status: ${c.status} | Effective Status: ${c.effective_status} | Created: ${c.created_time}`);
            });
        } else {
            console.error("Error or no data:", json);
        }
    } catch (err) {
        console.error(err);
    }
}

run().catch(console.error);
