const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

const CLONE_TARGETS = [
    {
        userId: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', // GNR HOMES
        name: 'GNR HOMES',
        sourceCampaignId: '52545419490244'
    },
    {
        userId: 'c890a11f-84ce-4592-ab8f-8682927b1a9d', // Realty Nation
        name: 'Realty Nation',
        sourceCampaignId: '120248925292990295'
    },
    {
        userId: '29937131-1975-4c5f-9b78-e5b28f918d32', // The ProEstate
        name: 'The ProEstate',
        sourceCampaignId: '120248571113060642'
    }
];

async function run() {
    console.log("Starting automated campaign cloning & optimization...");

    for (const target of CLONE_TARGETS) {
        console.log(`\n====================================================================`);
        console.log(`PROCESSING CLIENT: ${target.name} (${target.userId})`);
        console.log(`====================================================================`);

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('facebook_token, ad_account_id')
            .eq('id', target.userId)
            .single();

        if (!profile || !profile.facebook_token || !profile.ad_account_id) {
            console.error(`❌ Missing credentials for ${target.name}`);
            continue;
        }

        const token = profile.facebook_token;
        const adAccountId = profile.ad_account_id;

        try {
            // 1. Fetch Source Campaign Details
            const campaignRes = await fetch(`${FB_MARKETING_URL}/${target.sourceCampaignId}?fields=name,objective,daily_budget,lifetime_budget,buying_type,special_ad_categories,bid_strategy&access_token=${token}`);
            const campaignDetails = await campaignRes.json();
            if (campaignDetails.error) {
                console.error(`❌ Failed to fetch campaign:`, campaignDetails.error.message);
                continue;
            }

            const hasCampaignBudget = campaignDetails.daily_budget || campaignDetails.lifetime_budget;
            console.log(`Source uses Campaign Budget: ${!!hasCampaignBudget} | Bid Strategy: ${campaignDetails.bid_strategy}`);

            // 2. Fetch Source AdSets
            const adsetsRes = await fetch(`${FB_MARKETING_URL}/${target.sourceCampaignId}/adsets?fields=id,name,billing_event,optimization_goal,destination_type,promoted_object,targeting,daily_budget,lifetime_budget,bid_amount,bid_strategy,bid_constraints&access_token=${token}`);
            const adsetsData = await adsetsRes.json();
            const adsets = adsetsData.data || [];

            if (adsets.length === 0) {
                console.warn(`⚠️ No adsets in source campaign.`);
                continue;
            }

            // 3. Create Campaign
            const newCampaignName = `[Optimized] ${campaignDetails.name} - HomeOnly - A+`;
            const campPayload = {
                name: newCampaignName,
                objective: campaignDetails.objective,
                status: 'ACTIVE',
                buying_type: campaignDetails.buying_type || 'AUCTION',
                special_ad_categories: campaignDetails.special_ad_categories || [],
                access_token: token
            };

            if (campaignDetails.bid_strategy) {
                campPayload.bid_strategy = campaignDetails.bid_strategy;
            }

            if (hasCampaignBudget) {
                if (campaignDetails.daily_budget) campPayload.daily_budget = campaignDetails.daily_budget;
                if (campaignDetails.lifetime_budget) campPayload.lifetime_budget = campaignDetails.lifetime_budget;
            } else {
                campPayload.is_adset_budget_sharing_enabled = false;
            }

            const campCreateRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/campaigns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(campPayload)
            });
            const campCreateData = await campCreateRes.json();
            if (campCreateData.error) {
                console.error(`❌ Campaign creation failed:`, campCreateData.error.message);
                continue;
            }

            const newCampaignId = campCreateData.id;
            console.log(`✅ Campaign Created! ID: ${newCampaignId}`);

            // 4. Create AdSets
            for (const adset of adsets) {
                const targeting = { ...adset.targeting };
                if (targeting.geo_locations) {
                    targeting.geo_locations = {
                        ...targeting.geo_locations,
                        location_types: ['home']
                    };
                }
                targeting.targeting_automation = { advantage_audience: 1 };
                targeting.targeting_relaxation_types = { custom_audience: 1, lookalike: 1 };
                targeting.device_platforms = ['mobile', 'desktop'];
                targeting.publisher_platforms = ['facebook', 'instagram'];
                delete targeting.facebook_positions;
                delete targeting.instagram_positions;
                delete targeting.messenger_positions;

                // Adjust age constraints for Advantage+ Audience compatibility (age_min <= 25, age_max >= 65)
                targeting.age_min = targeting.age_min ? Math.min(targeting.age_min, 25) : 18;
                targeting.age_max = 65;

                const adsetPayload = {
                    name: `[Optimized] ${adset.name}`,
                    campaign_id: newCampaignId,
                    billing_event: adset.billing_event,
                    optimization_goal: adset.optimization_goal,
                    destination_type: adset.destination_type,
                    promoted_object: adset.promoted_object,
                    targeting: targeting,
                    status: 'ACTIVE',
                    access_token: token
                };

                // Copy bid parameters if they exist
                if (adset.bid_amount) adsetPayload.bid_amount = adset.bid_amount;
                if (adset.bid_strategy) adsetPayload.bid_strategy = adset.bid_strategy;
                if (adset.bid_constraints) adsetPayload.bid_constraints = adset.bid_constraints;

                // Budget logic: Set budget on AdSet ONLY if it is not set on the campaign
                if (!hasCampaignBudget) {
                    if (adset.daily_budget) adsetPayload.daily_budget = adset.daily_budget;
                    if (adset.lifetime_budget) adsetPayload.lifetime_budget = adset.lifetime_budget;
                    if (!adsetPayload.daily_budget && !adsetPayload.lifetime_budget) {
                        adsetPayload.daily_budget = 30000; // fallback default ₹300
                    }
                }

                const adsetCreateRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(adsetPayload)
                });
                const adsetCreateData = await adsetCreateRes.json();
                if (adsetCreateData.error) {
                    console.error(`  ... AdSet creation failed:`, adsetCreateData.error.message);
                    continue;
                }

                const newAdSetId = adsetCreateData.id;
                console.log(`  ... AdSet Created! ID: ${newAdSetId}`);

                // 5. Fetch and Copy Ads
                const adsRes = await fetch(`${FB_MARKETING_URL}/${adset.id}/ads?fields=id,name,creative{id}&access_token=${token}`);
                const adsData = await adsRes.json();
                const ads = adsData.data || [];

                for (const ad of ads) {
                    if (!ad.creative || !ad.creative.id) continue;

                    const adPayload = {
                        name: `${ad.name} [Optimized]`,
                        adset_id: newAdSetId,
                        creative: { creative_id: ad.creative.id },
                        status: 'ACTIVE',
                        access_token: token
                    };

                    const adCreateRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/ads`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(adPayload)
                    });
                    const adCreateData = await adCreateRes.json();
                    if (adCreateData.error) {
                        console.error(`    ... Ad "${ad.name}" copy failed:`, adCreateData.error.message);
                    } else {
                        console.log(`    ... Ad "${ad.name}" Copied! ID: ${adCreateData.id}`);
                    }
                }
            }

        } catch (e) {
            console.error(`❌ Unexpected error for ${target.name}:`, e.message);
        }
    }
    console.log("\nCampaign cloning and optimization complete!");
}

run().catch(console.error);
