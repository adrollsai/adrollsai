const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    
    // 1. Check profiles table
    console.log("=== PROFILE DETAILS ===");
    const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
    if (profileErr) {
        console.error("Error fetching profile:", profileErr);
    } else {
        console.log({
            id: profile.id,
            email: profile.email,
            fb_user_id: profile.fb_user_id,
            selected_page_id: profile.selected_page_id,
            selected_page_name: profile.selected_page_name,
            selected_ad_account_id: profile.selected_ad_account_id,
            selected_ad_account_name: profile.selected_ad_account_name,
            pixel_id: profile.pixel_id,
            onboarding_completed: profile.onboarding_completed,
            role: profile.role
        });
    }

    // 2. Check agent_ad_campaigns
    console.log("\n=== AGENT AD CAMPAIGNS ===");
    const { data: campaigns, error: campaignErr } = await supabaseAdmin
        .from('agent_ad_campaigns')
        .select('*')
        .eq('user_id', userId);
    if (campaignErr) {
        console.error("Error fetching agent ad campaigns:", campaignErr);
    } else {
        console.log(JSON.stringify(campaigns, null, 2));
    }
}

run().catch(console.error);
