const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('email', 'rchopra489@gmail.com')
        .single();
    
    const adAccountId = profile.ad_account_id;
    const token = profile.facebook_token;
    
    console.log("Querying Meta Ad Account common billing/funding fields...");
    const url = `https://graph.facebook.com/v19.0/${adAccountId}?fields=account_status,disable_reason,currency,funding_source,funding_source_details,balance&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    console.log("Meta Ad Account response:", JSON.stringify(data, null, 2));
}

run().catch(console.error);
