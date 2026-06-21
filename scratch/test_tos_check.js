const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = '2b0312dc-c1fc-4798-ab1c-339939271229'; // Adrolls Realty profile
    
    console.log("=== Querying Ad Account TOS Accepted status ===");
    const { data: prof, error: pErr } = await supabase
        .from('profiles')
        .select('facebook_token, ad_account_id')
        .eq('id', userId)
        .single();

    if (pErr || !prof) {
        console.error("Profile query error:", pErr);
        return;
    }

    const token = prof.facebook_token;
    const adAccountId = prof.ad_account_id;
    
    const fbUrl = `https://graph.facebook.com/v19.0/${adAccountId}?fields=tos_accepted&access_token=${token}`;
    try {
        const res = await fetch(fbUrl);
        const data = await res.json();
        
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

run().catch(console.error);
