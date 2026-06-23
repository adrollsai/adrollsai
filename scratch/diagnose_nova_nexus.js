const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
    console.log("Loading profiles with facebook tokens...");
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, facebook_token, ad_account_id, selected_page_id')
        .not('facebook_token', 'is', null);
        
    if (error) {
        console.error("Query Error:", error);
        return;
    }

    console.log(`Found ${profiles.length} profiles with tokens. Searching for campaign 'Nova Nexus'...`);

    let foundCampaign = null;
    let foundProfile = null;

    for (const profile of profiles) {
        if (!profile.ad_account_id) continue;
        const token = profile.facebook_token;
        if (!token.startsWith('EAA')) continue; // skip invalid tokens

        try {
            const url = `${FB_MARKETING_URL}/${profile.ad_account_id}/campaigns?fields=id,name,status,objective&limit=50&access_token=${token}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.error) {
                // console.log(`[${profile.business_name}] API Error:`, data.error.message);
                continue;
            }

            const campaigns = data.data || [];
            const match = campaigns.find(c => c.name.toLowerCase().includes('nova nexus') || c.name.toLowerCase().includes('nexus'));
            if (match) {
                console.log(`\n🎉 MATCH FOUND in profile: "${profile.business_name}" (${profile.id})`);
                console.log(`Campaign Name: "${match.name}"`);
                console.log(`Campaign ID: ${match.id}`);
                console.log(`Campaign Objective: ${match.objective}`);
                console.log(`Campaign Status: ${match.status}`);
                foundCampaign = match;
                foundProfile = profile;
                break;
            }
        } catch (e) {
            console.error(`Error querying ${profile.business_name}:`, e.message);
        }
    }

    if (!foundCampaign) {
        console.log("\n❌ 'Nova Nexus' campaign was not found in any of the connected accounts.");
        // Let's also check Realty Nation and The ProEstate accounts directly for all campaigns to diagnose what they have.
        console.log("\nQuerying campaigns for Realty Nation and The ProEstate directly...");
        const realtyNation = profiles.find(p => p.business_name === 'Realty Nation');
        const proEstate = profiles.find(p => p.business_name === 'The ProEstate');

        if (realtyNation) await dumpAccountCampaigns(realtyNation);
        if (proEstate) await dumpAccountCampaigns(proEstate);
        return;
    }

    // Diagnose the matched campaign
    await diagnoseCampaign(foundCampaign.id, foundProfile);
}

async function dumpAccountCampaigns(profile) {
    console.log(`\n=== Campaigns in ${profile.business_name} (${profile.ad_account_id}) ===`);
    try {
        const url = `${FB_MARKETING_URL}/${profile.ad_account_id}/campaigns?fields=id,name,status,objective,effective_status&limit=10&access_token=${profile.facebook_token}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) {
            console.log("Error:", data.error.message);
            return;
        }
        const campaigns = data.data || [];
        for (const c of campaigns) {
            console.log(`- Campaign ID: ${c.id} | Name: "${c.name}" | Status: ${c.status} | Objective: ${c.objective} | EffStatus: ${c.effective_status}`);
            // Let's diagnose each campaign briefly
            await diagnoseCampaign(c.id, profile);
        }
    } catch (e) {
        console.error("Fetch failed:", e.message);
    }
}

async function diagnoseCampaign(campaignId, profile) {
    const token = profile.facebook_token;
    console.log(`\n=== DIAGNOSING CAMPAIGN ${campaignId} (Profile: ${profile.business_name}) ===`);
    
    try {
        // 1. Fetch Ad Sets
        const adsetsUrl = `${FB_MARKETING_URL}/${campaignId}/adsets?fields=id,name,status,effective_status,targeting,billing_event,optimization_goal,destination_type,promoted_object,daily_budget,lifetime_budget&access_token=${token}`;
        const adsetsRes = await fetch(adsetsUrl);
        const adsetsData = await adsetsRes.json();
        
        if (adsetsData.error) {
            console.error("Adsets Fetch Error:", adsetsData.error.message);
            return;
        }

        const adsets = adsetsData.data || [];
        console.log(`Found ${adsets.length} Ad Sets.`);

        for (const adset of adsets) {
            console.log(`\n--> AdSet ID: ${adset.id}`);
            console.log(`    Name: "${adset.name}"`);
            console.log(`    Status: ${adset.status} (Effective: ${adset.effective_status})`);
            console.log(`    Optimization Goal: ${adset.optimization_goal}`);
            console.log(`    Billing Event: ${adset.billing_event}`);
            console.log(`    Destination Type: ${adset.destination_type}`);
            console.log(`    Promoted Object:`, JSON.stringify(adset.promoted_object));
            console.log(`    Targeting:`, JSON.stringify(adset.targeting));
            console.log(`    Budget: Daily=${adset.daily_budget ? adset.daily_budget/100 : 'N/A'} | Lifetime=${adset.lifetime_budget ? adset.lifetime_budget/100 : 'N/A'}`);

            // 2. Fetch Ads for this Ad Set
            const adsUrl = `${FB_MARKETING_URL}/${adset.id}/ads?fields=id,name,status,effective_status,adcreatives{id,name,object_story_spec,object_type},insights{impressions,clicks,spend,actions}&access_token=${token}`;
            const adsRes = await fetch(adsUrl);
            const adsData = await adsRes.json();
            
            if (adsData.error) {
                console.error("    Ads Fetch Error:", adsData.error.message);
                continue;
            }

            const ads = adsData.data || [];
            console.log(`    Found ${ads.length} Ads in this AdSet:`);
            
            for (const ad of ads) {
                console.log(`    * Ad ID: ${ad.id}`);
                console.log(`      Name: "${ad.name}"`);
                console.log(`      Status: ${ad.status} (Effective: ${ad.effective_status})`);
                
                // Insights
                if (ad.insights && ad.insights.data && ad.insights.data.length > 0) {
                    const ins = ad.insights.data[0];
                    console.log(`      Insights: Spend=${ins.spend} | Impressions=${ins.impressions} | Clicks=${ins.clicks} | Actions=`, JSON.stringify(ins.actions));
                } else {
                    console.log(`      Insights: No recent delivery performance data (0 impressions/spend or no insights fetched).`);
                }

                // Check creative details
                const creatives = ad.adcreatives?.data || [];
                for (const creative of creatives) {
                    console.log(`      Creative ID: ${creative.id}`);
                    if (creative.object_story_spec) {
                        const spec = creative.object_story_spec;
                        console.log(`      Page ID: ${spec.page_id}`);
                        
                        // Check link data (lead form or website conversion URL)
                        if (spec.link_data) {
                            const ld = spec.link_data;
                            console.log(`      Link URL: ${ld.link}`);
                            console.log(`      Call to Action:`, JSON.stringify(ld.call_to_action));
                            
                            // Check leadgen form ID
                            if (ld.call_to_action && ld.call_to_action.value) {
                                const val = ld.call_to_action.value;
                                if (val.lead_gen_form_id) {
                                    console.log(`      🎯 Lead Gen Form ID: ${val.lead_gen_form_id}`);
                                    // Query Form details
                                    await checkLeadForm(val.lead_gen_form_id, token);
                                }
                            }
                        }
                        
                        // Check video data call to action
                        if (spec.video_data && spec.video_data.call_to_action) {
                            const cta = spec.video_data.call_to_action;
                            console.log(`      Video CTA Link URL: ${cta.value?.link}`);
                            if (cta.value?.lead_gen_form_id) {
                                console.log(`      🎯 Lead Gen Form ID (Video): ${cta.value.lead_gen_form_id}`);
                                await checkLeadForm(cta.value.lead_gen_form_id, token);
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error("Diagnosis error:", e.message);
    }
}

async function checkLeadForm(formId, token) {
    try {
        const url = `${FB_MARKETING_URL}/${formId}?fields=id,name,status,leads_count,privacy_policy,questions,follow_up_action_url,expired_leads_count,is_shared_to_advertising_partner&access_token=${token}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) {
            console.error(`      Lead Form Error for ${formId}:`, data.error.message);
            return;
        }
        console.log(`      === Form Details: "${data.name}" ===`);
        console.log(`      Form Status: ${data.status}`);
        console.log(`      Leads Count (Meta reported): ${data.leads_count}`);
        console.log(`      Expired Leads Count: ${data.expired_leads_count}`);
        console.log(`      Follow-up Action URL: ${data.follow_up_action_url}`);
        console.log(`      Privacy Policy:`, JSON.stringify(data.privacy_policy));
        console.log(`      Questions:`, JSON.stringify(data.questions));
    } catch (e) {
        console.error("Form check error:", e.message);
    }
}

run().catch(console.error);
