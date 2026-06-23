const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
    console.log("Loading target profiles...");
    const targets = [
        '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', // GNR HOMES
        'c890a11f-84ce-4592-ab8f-8682927b1a9d', // Realty Nation
        '29937131-1975-4c5f-9b78-e5b28f918d32'  // The ProEstate
    ];

    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, facebook_token, ad_account_id');

    if (error) {
        console.error("Query Error:", error);
        return;
    }

    const matched = profiles.filter(p => targets.includes(p.id));

    for (const p of matched) {
        console.log(`\n======================================================`);
        console.log(`CLIENT: ${p.business_name} (${p.ad_account_id})`);
        console.log(`======================================================`);
        
        const token = p.facebook_token;
        if (!token) {
            console.log("⚠️ No token configured.");
            continue;
        }

        try {
            // 1. Get Ad Account Details (Currency, Account Status)
            const accRes = await fetch(`${FB_MARKETING_URL}/${p.ad_account_id}?fields=name,currency,account_status,disable_reason,amount_spent&access_token=${token}`);
            const accData = await accRes.json();
            if (accData.error) {
                console.error("❌ Failed to fetch account info:", accData.error.message);
                continue;
            }
            console.log(`Ad Account Info: Currency=${accData.currency} | Status=${accData.account_status} | Spent=${accData.amount_spent/100}`);

            // 2. Get Campaigns
            const campRes = await fetch(`${FB_MARKETING_URL}/${p.ad_account_id}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,special_ad_categories,effective_status&limit=10&access_token=${token}`);
            const campData = await campRes.json();
            if (campData.error) {
                console.error("❌ Failed to fetch campaigns:", campData.error.message);
                continue;
            }

            const campaigns = campData.data || [];
            console.log(`Found ${campaigns.length} campaigns.`);

            for (const camp of campaigns) {
                console.log(`\n  --- Campaign: "${camp.name}" (${camp.id}) ---`);
                console.log(`      Status: ${camp.status} | Objective: ${camp.objective}`);
                console.log(`      Daily Budget: ${camp.daily_budget ? camp.daily_budget / 100 : 'CBO not used (budget at adset level)'}`);
                console.log(`      Special Ad Categories: ${JSON.stringify(camp.special_ad_categories)}`);
                
                // 3. Get Ad Sets
                const adsetsRes = await fetch(`${FB_MARKETING_URL}/${camp.id}/adsets?fields=id,name,status,effective_status,targeting,optimization_goal,destination_type,daily_budget,lifetime_budget&access_token=${token}`);
                const adsetData = await adsetsRes.json();
                const adsets = adsetData.data || [];
                
                for (const adset of adsets) {
                    console.log(`      -> Ad Set: "${adset.name}" (${adset.id})`);
                    console.log(`         Status: ${adset.status} (Effective: ${adset.effective_status})`);
                    console.log(`         Daily Budget: ${adset.daily_budget ? adset.daily_budget / 100 : 'N/A'}`);
                    console.log(`         Targeting:`, JSON.stringify(adset.targeting));
                    
                    // 4. Get Ads with Review Feedback and Delivery info
                    const adsRes = await fetch(`${FB_MARKETING_URL}/${adset.id}/ads?fields=id,name,status,effective_status,adcreatives{id,name},recommendations,creative{id},insights{spend,impressions,clicks,actions}&access_token=${token}`);
                    const adsData = await adsRes.json();
                    const ads = adsData.data || [];
                    
                    for (const ad of ads) {
                        console.log(`         * Ad: "${ad.name}" (${ad.id})`);
                        console.log(`           Status: ${ad.status} (Effective: ${ad.effective_status})`);
                        if (ad.recommendations) {
                            console.log(`           ⚠️ Recommendations:`, JSON.stringify(ad.recommendations));
                        }
                        
                        if (ad.insights && ad.insights.data && ad.insights.data.length > 0) {
                            const ins = ad.insights.data[0];
                            console.log(`           Performance: Spent=${ins.spend} | Impressions=${ins.impressions} | Clicks=${ins.clicks} | Actions=${JSON.stringify(ins.actions)}`);
                        } else {
                            console.log(`           Performance: No delivery data (spend=0)`);
                        }
                    }
                }
            }

        } catch (e) {
            console.error("Error processing account:", e.message);
        }
    }
}

run().catch(console.error);
