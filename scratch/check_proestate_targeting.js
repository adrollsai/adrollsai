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
    const campId = '120248729046110642';

    const { data: p } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token')
        .eq('id', proestateId)
        .single();

    const token = p.facebook_token;

    console.log("Querying adsets for campaign:", campId);
    const adsetsRes = await fetch(`${FB_MARKETING_URL}/${campId}/adsets?fields=id,name,status,effective_status,targeting,optimization_goal,billing_event,bid_amount,bid_strategy,bid_constraints&access_token=${token}`);
    const adsetData = await adsetsRes.json();
    console.log("Adsets Details:", JSON.stringify(adsetData, null, 2));
}

run().catch(console.error);
