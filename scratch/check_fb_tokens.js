const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
        
    if (error) {
        console.error(error);
        return;
    }
    
    console.log("=== TOKENS ===");
    console.log("selected_page_token exists:", !!profile.selected_page_token);
    if (profile.selected_page_token) {
        console.log("selected_page_token (truncated):", profile.selected_page_token.substring(0, 20) + "...");
    }
    console.log("facebook_access_token exists:", !!profile.facebook_access_token);
    if (profile.facebook_access_token) {
        console.log("facebook_access_token (truncated):", profile.facebook_access_token.substring(0, 20) + "...");
    }
    console.log("access_token exists:", !!profile.access_token);
}

run().catch(console.error);
