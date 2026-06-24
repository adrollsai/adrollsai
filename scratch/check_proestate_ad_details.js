const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
    const proestateId = '29937131-1975-4c5f-9b78-e5b28f918d32'; // The ProEstate
    const adsetId = '120248729047010642';

    const { data: p } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token')
        .eq('id', proestateId)
        .single();

    const token = p.facebook_token;

    console.log("Querying ads for adset:", adsetId);
    const adsRes = await fetch(`${FB_MARKETING_URL}/${adsetId}/ads?fields=id,name,status,effective_status,recommendations,issues_info,creative{id,name}&access_token=${token}`);
    const adsData = await adsRes.json();
    console.log("Raw Ads Data:", JSON.stringify(adsData, null, 2));
}

run().catch(console.error);
