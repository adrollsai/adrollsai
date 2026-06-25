const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

const subAccounts = [
    { name: 'Realty Nation', userId: 'c890a11f-84ce-4592-ab8f-8682927b1a9d', campaignId: '120249015633660295' },
    { name: 'GNR Homes', userId: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', campaignId: '52547215473044' },
    { name: 'The ProEstate', userId: '29937131-1975-4c5f-9b78-e5b28f918d32', campaignId: '120248729046110642' }
];

async function run() {
    for (const acc of subAccounts) {
        console.log(`\n======================================================`);
        console.log(`TARGETING & CONFIG: ${acc.name}`);
        console.log(`======================================================`);
        
        const { data: p } = await supabaseAdmin
            .from('profiles')
            .select('facebook_token')
            .eq('id', acc.userId)
            .single();

        if (!p || !p.facebook_token) {
            console.log(`No token for ${acc.name}`);
            continue;
        }

        const adsetsRes = await fetch(`${FB_MARKETING_URL}/${acc.campaignId}/adsets?fields=id,name,status,effective_status,targeting,optimization_goal,billing_event,bid_amount,bid_strategy,bid_constraints&access_token=${p.facebook_token}`);
        const adsetData = await adsetsRes.json();
        
        if (adsetData.error) {
            console.error(`Error:`, adsetData.error.message);
            continue;
        }
        
        adsetData.data?.forEach(adset => {
            console.log(`Ad Set: "${adset.name}" (${adset.id})`);
            console.log(`  Optimization Goal: ${adset.optimization_goal}`);
            console.log(`  Billing Event: ${adset.billing_event}`);
            console.log(`  Bid Strategy: ${adset.bid_strategy || 'Default (Lowest Cost / Highest Volume)'}`);
            console.log(`  Bid Constraints:`, adset.bid_constraints || 'None');
            console.log(`  Targeting locations:`, JSON.stringify(adset.targeting?.geo_locations || {}));
            console.log(`  Targeting Age: ${adset.targeting?.age_min} - ${adset.targeting?.age_max}`);
            console.log(`  Advantage Audience: ${adset.targeting?.targeting_automation?.advantage_audience || 'Not configured'}`);
            console.log(`  Targeting Exclusions/Interests:`, JSON.stringify(adset.targeting?.flexible_spec || 'None'));
        });
    }
}

run().catch(console.error);
