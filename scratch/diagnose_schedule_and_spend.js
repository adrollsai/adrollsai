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
        console.log(`ANALYZING: ${p.business_name} (${p.ad_account_id})`);
        console.log(`======================================================`);
        
        const token = p.facebook_token;
        if (!token) {
            console.log("⚠️ No token configured.");
            continue;
        }

        try {
            // Get Campaigns
            const campRes = await fetch(`${FB_MARKETING_URL}/${p.ad_account_id}/campaigns?fields=id,name,status,effective_status,start_time,stop_time,daily_budget,lifetime_budget,budget_remaining&limit=10&access_token=${token}`);
            const campData = await campRes.json();
            if (campData.error) {
                console.error("❌ Failed to fetch campaigns:", campData.error.message);
                continue;
            }

            const campaigns = campData.data || [];
            const activeCampaigns = campaigns.filter(c => c.status === 'ACTIVE' || c.effective_status === 'ACTIVE');

            if (activeCampaigns.length === 0) {
                console.log("No active campaigns found.");
                continue;
            }

            for (const camp of activeCampaigns) {
                console.log(`\n* Campaign: "${camp.name}" (${camp.id})`);
                console.log(`  Status: ${camp.status} (Effective: ${camp.effective_status})`);
                console.log(`  Start Time: ${camp.start_time || 'N/A'} | Stop Time: ${camp.stop_time || 'N/A'}`);
                console.log(`  Daily Budget: ${camp.daily_budget ? camp.daily_budget / 100 : 'N/A'}`);
                console.log(`  Budget Remaining: ${camp.budget_remaining ? camp.budget_remaining / 100 : 'N/A'}`);

                // Query Insights for today
                const insTodayRes = await fetch(`${FB_MARKETING_URL}/${camp.id}/insights?date_preset=today&fields=spend,impressions,clicks&access_token=${token}`);
                const insToday = await insTodayRes.json();
                const todayData = insToday.data && insToday.data[0];
                console.log(`  Insights TODAY: Spend=${todayData ? todayData.spend : 0} | Impressions=${todayData ? todayData.impressions : 0} | Clicks=${todayData ? todayData.clicks : 0}`);

                // Query Insights for yesterday
                const insYestRes = await fetch(`${FB_MARKETING_URL}/${camp.id}/insights?date_preset=yesterday&fields=spend,impressions,clicks&access_token=${token}`);
                const insYest = await insYestRes.json();
                const yestData = insYest.data && insYest.data[0];
                console.log(`  Insights YESTERDAY: Spend=${yestData ? yestData.spend : 0} | Impressions=${yestData ? yestData.impressions : 0} | Clicks=${yestData ? yestData.clicks : 0}`);

                // Query Insights for lifetime
                const insLifeRes = await fetch(`${FB_MARKETING_URL}/${camp.id}/insights?date_preset=lifetime&fields=spend,impressions,clicks&access_token=${token}`);
                const insLife = await insLifeRes.json();
                const lifeData = insLife.data && insLife.data[0];
                console.log(`  Insights LIFETIME: Spend=${lifeData ? lifeData.spend : 0} | Impressions=${lifeData ? lifeData.impressions : 0} | Clicks=${lifeData ? lifeData.clicks : 0}`);

                // Get Ad Sets stop / end time
                const adsetsRes = await fetch(`${FB_MARKETING_URL}/${camp.id}/adsets?fields=id,name,status,effective_status,start_time,end_time&access_token=${token}`);
                const adsetData = await adsetsRes.json();
                const adsets = adsetData.data || [];
                
                for (const adset of adsets) {
                    if (adset.status !== 'ACTIVE' && adset.effective_status !== 'ACTIVE') continue;
                    console.log(`  -> Ad Set: "${adset.name}" (${adset.id})`);
                    console.log(`     Status: ${adset.status} (Effective: ${adset.effective_status})`);
                    console.log(`     Start Time: ${adset.start_time || 'N/A'} | End Time: ${adset.end_time || 'N/A'}`);

                    // Fetch Ads in the Ad Set
                    const adsRes = await fetch(`${FB_MARKETING_URL}/${adset.id}/ads?fields=id,name,status,effective_status,recommendations&access_token=${token}`);
                    const adsData = await adsRes.json();
                    const ads = adsData.data || [];
                    for (const ad of ads) {
                        if (ad.status !== 'ACTIVE' && ad.effective_status !== 'ACTIVE') continue;
                        console.log(`     * Ad: "${ad.name}" (${ad.id})`);
                        console.log(`       Status: ${ad.status} (Effective: ${ad.effective_status})`);
                        
                        // Query Ad Insights today
                        const adInsToday = await fetch(`${FB_MARKETING_URL}/${ad.id}/insights?date_preset=today&fields=spend,impressions,clicks&access_token=${token}`).then(r => r.json());
                        const adToday = adInsToday.data && adInsToday.data[0];
                        console.log(`       Ad Insights TODAY: Spend=${adToday ? adToday.spend : 0} | Impressions=${adToday ? adToday.impressions : 0}`);
                    }
                }
            }
        } catch (e) {
            console.error("Error analyzing client:", e.message);
        }
    }
}

run().catch(console.error);
