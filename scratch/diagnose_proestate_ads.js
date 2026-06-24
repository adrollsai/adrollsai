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

    const { data: p, error } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, facebook_token, ad_account_id')
        .eq('id', proestateId)
        .single();

    if (error || !p) {
        console.error("Query Error:", error);
        return;
    }

    console.log(`\n======================================================`);
    console.log(`DIAGNOSING ADS FOR: ${p.business_name} (${p.ad_account_id})`);
    console.log(`======================================================`);
    
    const token = p.facebook_token;
    if (!token) {
        console.log("⚠️ No token configured.");
        return;
    }

    try {
        // Query active campaigns
        const campRes = await fetch(`${FB_MARKETING_URL}/${p.ad_account_id}/campaigns?fields=id,name,status,effective_status&limit=5&access_token=${token}`);
        const campData = await campRes.json();
        const campaigns = campData.data || [];

        for (const camp of campaigns) {
            if (camp.status !== 'ACTIVE' && camp.effective_status !== 'ACTIVE') continue;
            console.log(`\nCampaign: "${camp.name}" (${camp.id})`);

            // Query Ad Sets
            const adsetsRes = await fetch(`${FB_MARKETING_URL}/${camp.id}/adsets?fields=id,name,status,effective_status&access_token=${token}`);
            const adsetData = await adsetsRes.json();
            const adsets = adsetData.data || [];

            for (const adset of adsets) {
                console.log(`  Ad Set: "${adset.name}" (${adset.id}) | Status: ${adset.status} (Effective: ${adset.effective_status})`);

                // Query Ads with creative, review_feedback, recommendations, issues_info, and status details
                const adsRes = await fetch(`${FB_MARKETING_URL}/${adset.id}/ads?fields=id,name,status,effective_status,recommendations,issues_info,creative{id,name,review_status,run_status}&access_token=${token}`);
                const adsData = await adsRes.json();
                const ads = adsData.data || [];

                for (const ad of ads) {
                    console.log(`    Ad: "${ad.name}" (${ad.id})`);
                    console.log(`      Status: ${ad.status} (Effective: ${ad.effective_status})`);
                    if (ad.recommendations) {
                        console.log(`      ⚠️ Recommendations:`, JSON.stringify(ad.recommendations, null, 2));
                    }
                    if (ad.issues_info) {
                        console.log(`      ⚠️ Issues Info:`, JSON.stringify(ad.issues_info, null, 2));
                    }
                    if (ad.creative) {
                        console.log(`      Creative ID: ${ad.creative.id}`);
                        console.log(`      Creative Review Status: ${ad.creative.review_status || 'N/A'}`);
                        console.log(`      Creative Run Status: ${ad.creative.run_status || 'N/A'}`);
                        
                        // Query creative details to see if the video/image itself has a review status or validation issue
                        const creativeRes = await fetch(`${FB_MARKETING_URL}/${ad.creative.id}?fields=id,name,status,review_status,asset_data&access_token=${token}`);
                        const creativeData = await creativeRes.json();
                        console.log(`      Creative details review_status: ${creativeData.review_status || 'N/A'}`);
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error during ad diagnostics:", e.message);
    }
}

run().catch(console.error);
