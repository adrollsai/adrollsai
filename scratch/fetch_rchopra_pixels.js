const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Fetching rchopra489@gmail.com Profile ===");
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token, pixel_id, ad_account_id, email, business_name')
        .eq('id', 'bc63c065-9bcc-4793-bedc-f0960406425b')
        .single();
    
    if (error || !profile) {
        console.error("Failed to load profile:", error);
        return;
    }

    const { facebook_token, pixel_id, ad_account_id, email, business_name } = profile;
    console.log("Profile Email:", email);
    console.log("Business Name:", business_name);
    console.log("Profile Pixel ID:", pixel_id);
    console.log("Profile Ad Account ID:", ad_account_id);

    if (!facebook_token) {
        console.log("No facebook token found for this profile.");
        return;
    }

    if (!ad_account_id) {
        console.log("No ad account ID found for this profile.");
        return;
    }

    // Fetch pixels for the ad account from Meta
    console.log(`\n=== Fetching Pixels for Ad Account ${ad_account_id} from Meta ===`);
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
