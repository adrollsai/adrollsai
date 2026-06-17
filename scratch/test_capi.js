const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Fetching Realty Nation Credentials ===");
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token, selected_page_token, pixel_id, ad_account_id')
        .eq('id', 'c890a11f-84ce-4592-ab8f-8682927b1a9d')
        .single();
    
    if (error || !profile) {
        console.error("Failed to load profile:", error);
        return;
    }

    const { facebook_token, pixel_id, ad_account_id } = profile;
    console.log("Profile Pixel ID:", pixel_id);
    console.log("Profile Ad Account ID:", ad_account_id);

    // Fetch pixels for the ad account
    console.log(`\n=== Fetching Pixels for Ad Account ${ad_account_id} ===`);
    try {
        const url = `https://graph.facebook.com/v19.0/${ad_account_id}/adspixels?fields=name,id,creation_time&access_token=${facebook_token}`;
        const res = await fetch(url);
        const data = await res.json();
        console.log("Meta API Pixels response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Failed to fetch pixels:", e);
    }
}

run().catch(console.error);
