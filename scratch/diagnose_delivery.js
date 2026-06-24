const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
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
        console.log(`DIAGNOSING: ${p.business_name} (${p.ad_account_id})`);
        console.log(`======================================================`);
        
        const token = p.facebook_token;
        if (!token) {
            console.log("⚠️ No token configured.");
            continue;
        }

        try {
            // 1. Get Ad Account Details with balance and spend_cap
            const accRes = await fetch(`${FB_MARKETING_URL}/${p.ad_account_id}?fields=name,currency,account_status,disable_reason,amount_spent,balance,spend_cap,funding_source,funding_source_details&access_token=${token}`);
            const accData = await accRes.json();
            if (accData.error) {
                console.error("❌ Failed to fetch account info:", accData.error.message);
                continue;
            }
            console.log(`Ad Account Name: ${accData.name}`);
            console.log(`Account Status: ${accData.account_status} (1=Active, 2=Disabled, 3=Unconfirmed, 7=In Review, 9=In Grace Period, 101=Closed)`);
            console.log(`Disable Reason: ${accData.disable_reason || 'None'}`);
            console.log(`Unpaid Balance: ${accData.balance ? accData.balance / 100 : 0} ${accData.currency}`);
            console.log(`Spend Cap: ${accData.spend_cap ? accData.spend_cap / 100 : 'No Cap'}`);
            console.log(`Amount Spent (Total): ${accData.amount_spent ? accData.amount_spent / 100 : 0} ${accData.currency}`);
            console.log(`Funding Source ID: ${accData.funding_source || 'None'}`);
            console.log(`Funding Source Details:`, JSON.stringify(accData.funding_source_details || null));

            // 2. Get Campaigns
            const campRes = await fetch(`${FB_MARKETING_URL}/${p.ad_account_id}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,effective_status,budget_remaining,issues_info&limit=5&access_token=${token}`);
            const campData = await campRes.json();
            if (campData.error) {
                console.error("❌ Failed to fetch campaigns:", campData.error.message);
                continue;
            }

            const campaigns = campData.data || [];
            console.log(`\nCampaigns Diagnostic (${campaigns.length} found):`);

            for (const camp of campaigns) {
                if (camp.status !== 'ACTIVE' && camp.effective_status !== 'ACTIVE') continue; // only check active campaigns
                console.log(`\n  * Campaign: "${camp.name}" (${camp.id})`);
                console.log(`    Status: ${camp.status} (Effective: ${camp.effective_status})`);
                console.log(`    Daily Budget: ${camp.daily_budget ? camp.daily_budget / 100 : 'N/A'}`);
                console.log(`    Lifetime Budget: ${camp.lifetime_budget ? camp.lifetime_budget / 100 : 'N/A'}`);
                console.log(`    Budget Remaining: ${camp.budget_remaining ? camp.budget_remaining / 100 : 'N/A'}`);
                if (camp.issues_info) {
                    console.log(`    ⚠️ Issues:`, JSON.stringify(camp.issues_info));
                }

                // 3. Get Ad Sets
                const adsetsRes = await fetch(`${FB_MARKETING_URL}/${camp.id}/adsets?fields=id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,issues_info&access_token=${token}`);
                const adsetData = await adsetsRes.json();
                const adsets = adsetData.data || [];
                
                for (const adset of adsets) {
                    if (adset.status !== 'ACTIVE' && adset.effective_status !== 'ACTIVE') continue;
                    console.log(`    -> Ad Set: "${adset.name}" (${adset.id})`);
                    console.log(`       Status: ${adset.status} (Effective: ${adset.effective_status})`);
                    console.log(`       Optimization Goal: ${adset.optimization_goal} | Billing Event: ${adset.billing_event}`);
                    if (adset.issues_info) {
                        console.log(`       ⚠️ Issues:`, JSON.stringify(adset.issues_info));
                    }

                    // 4. Get Ads
                    const adsRes = await fetch(`${FB_MARKETING_URL}/${adset.id}/ads?fields=id,name,status,effective_status,issues_info,adcreatives{id,name},insights{spend,impressions,clicks}&access_token=${token}`);
                    const adsData = await adsRes.json();
                    const ads = adsData.data || [];
                    
                    for (const ad of ads) {
                        if (ad.status !== 'ACTIVE' && ad.effective_status !== 'ACTIVE') continue;
                        console.log(`       * Ad: "${ad.name}" (${ad.id})`);
                        console.log(`         Status: ${ad.status} (Effective: ${ad.effective_status})`);
                        if (ad.issues_info) {
                            console.log(`         ⚠️ Issues:`, JSON.stringify(ad.issues_info));
                        }
                        
                        if (ad.insights && ad.insights.data && ad.insights.data.length > 0) {
                            const ins = ad.insights.data[0];
                            console.log(`         Insights: Spent=${ins.spend} | Impressions=${ins.impressions} | Clicks=${ins.clicks}`);
                        } else {
                            console.log(`         Insights: No delivery data (spend=0)`);
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
