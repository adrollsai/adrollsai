import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getOrgAdminCredentials } from '@/utils/org-helper'
import { sendNotification } from '@/utils/notification-helper'
import fs from 'fs'
import path from 'path'

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0"
const LOG_FILE = path.join(process.cwd(), 'meta_ads_debug.txt')

// --- LOGGER HELPER ---
function log(step: string, data: any) {
    const timestamp = new Date().toISOString()
    const content = typeof data === 'object' ? JSON.stringify(data, null, 2) : data
    const message = `\n[${timestamp}] [${step}]\n${content}\n------------------------------------------------`
    
    console.log(`[${step}]`, typeof data === 'string' ? data : '(Object logged to file)')
    try { fs.appendFileSync(LOG_FILE, message) } catch (e) { console.error("Log Error", e) }
}

export async function POST(request: Request) {
    try { fs.writeFileSync(LOG_FILE, '') } catch (e) {}
    log("INIT", "Starting Campaign Launch - Strict Payment Mode")

    const supabase = await createClient()
    
    // 1. Authenticate Agent
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 2. Get Agent Details
    const { data: agentProfile } = await supabase
        .from('profiles')
        .select('organization_id, facebook_token, ad_account_id, selected_page_id, pixel_id, total_xp')
        .eq('id', user.id)
        .single();

    if (!agentProfile?.organization_id || !agentProfile?.facebook_token || !agentProfile?.ad_account_id) {
        return NextResponse.json({ error: 'Please connect Ad Account & Page in Profile.' }, { status: 400 });
    }

    const formData = await request.formData();
    const propertyId = formData.get('propertyId')?.toString();
    const dailyBudgetINR = parseFloat(formData.get('dailyBudgetINR')?.toString() || '0'); 
    
    if (dailyBudgetINR < 100) return NextResponse.json({ error: 'Minimum daily budget is ₹100' }, { status: 400 });

    // VARIABLES TO TRACK FOR ROLLBACK
    let createdCampaignId: string | null = null;

    try {
        log("PRE_CHECK", "Verifying Ad Account Status & Payment...")
        const agentToken = agentProfile.facebook_token;
        const agentAdAccount = agentProfile.ad_account_id;

        // --- PRE-CHECK: PAYMENT METHOD ---
        const accountRes = await fetch(`${FB_MARKETING_URL}/${agentAdAccount}?fields=account_status,funding_source_details,disable_reason&access_token=${agentToken}`);
        const accountInfo = await accountRes.json();
        
        log("ACCOUNT_INFO", accountInfo);

        if (accountInfo.error) throw new Error("Account Check Failed: " + accountInfo.error.message);
        
        // Status 1 = Active.
        if (accountInfo.account_status !== 1) {
             throw new Error("Your Ad Account is not Active. Check Facebook Business Manager.");
        }

        // Check Funding Source
        const hasFunding = accountInfo.funding_source_details && (accountInfo.funding_source_details.id || accountInfo.funding_source_details.display_string);
        
        if (!hasFunding) {
             throw new Error("STOP: No Payment Method attached to this Ad Account. Please go to Facebook Billing and add a Credit Card.");
        }

        // --- PROCEED IF CHECK PASSES ---

        log("FETCH_TEMPLATE", "Fetching Admin Credentials...")
        const adminCreds = await getOrgAdminCredentials(supabase, agentProfile.organization_id);
        
        const { data: property } = await supabase.from('properties').select('*').eq('id', propertyId).single();
        if (!property?.template_adset_id) throw new Error("Project not configured with Ad Template.");

        // --- STEP A: READ TEMPLATE ---
        log("READ_TEMPLATE_ADSET", property.template_adset_id)
        const tplAdSetRes = await fetch(`${FB_MARKETING_URL}/${property.template_adset_id}?fields=name,optimization_goal,billing_event,bid_strategy,destination_type,targeting&access_token=${adminCreds.facebookToken}`);
        const tplAdSet = await tplAdSetRes.json();
        if (tplAdSet.error) throw new Error("Template Read Error: " + tplAdSet.error.message);
        
        const tplAdsRes = await fetch(`${FB_MARKETING_URL}/${property.template_adset_id}/ads?fields=creative&limit=1&access_token=${adminCreds.facebookToken}`);
        const tplAds = await tplAdsRes.json();
        if(!tplAds.data?.[0]) throw new Error("Template has no ads to clone.");
        
        const tplCreativeRes = await fetch(`${FB_MARKETING_URL}/${tplAds.data[0].creative.id}?fields=name,object_story_spec&access_token=${adminCreds.facebookToken}`);
        const tplCreative = await tplCreativeRes.json();

        // --- STEP B: PREPARE ASSETS ---
        const agentPageId = agentProfile.selected_page_id;

        // Create Lead Form
        const originalLink = tplCreative.object_story_spec?.link_data?.link || "https://facebook.com";
        const formPayload = {
            name: `Quick Inquiry - ${Date.now()}`,
            questions: [{ type: "FULL_NAME" }, { type: "PHONE" }, { type: "EMAIL" }],
            privacy_policy: { url: "https://privacy.com", link_text: "Privacy Policy" },
            follow_up_action_url: originalLink,
            access_token: agentToken
        };
        const formRes = await fetch(`${FB_MARKETING_URL}/${agentPageId}/leadgen_forms`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formPayload)
        });
        const formDataRes = await formRes.json();
        const newFormId = formDataRes.id; 

        // --- STEP C: EXECUTE CAMPAIGN ---
        
        // 1. Create Campaign
        const campaignPayload = {
            name: `[APP] ${property.title} - ${Date.now()}`,
            objective: 'OUTCOME_LEADS',
            status: 'PAUSED',
            buying_type: 'AUCTION',
            special_ad_categories: ['HOUSING'], 
            special_ad_category_country: ['IN'],
            is_adset_budget_sharing_enabled: false, 
            access_token: agentToken
        }
        
        const campRes = await fetch(`${FB_MARKETING_URL}/${agentAdAccount}/campaigns`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campaignPayload)
        });
        const campaign = await campRes.json();
        if (campaign.error) throw new Error(`Campaign Error: ${campaign.error.message}`);
        
        createdCampaignId = campaign.id; // TRACK FOR ROLLBACK
        log("CAMPAIGN_CREATED", campaign.id)


        // 2. Create Ad Set
        const adSetPayload = {
            name: `AdSet - ${property.title}`,
            campaign_id: campaign.id,
            daily_budget: dailyBudgetINR * 100, 
            optimization_goal: tplAdSet.optimization_goal || 'LEAD_GENERATION',
            billing_event: tplAdSet.billing_event || 'IMPRESSIONS',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            destination_type: tplAdSet.destination_type || 'ON_AD',
            promoted_object: { page_id: agentPageId },
            targeting: { geo_locations: { countries: ['IN'] } },
            status: 'PAUSED',
            access_token: agentToken
        }
        
        const adSetRes = await fetch(`${FB_MARKETING_URL}/${agentAdAccount}/adsets`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adSetPayload)
        });
        const adSet = await adSetRes.json();
        if (adSet.error) throw new Error(`AdSet Error: ${adSet.error.message}`);
        log("ADSET_CREATED", adSet.id)


        // 3. Create Creative
        let newSpec = JSON.parse(JSON.stringify(tplCreative.object_story_spec)); 
        newSpec.page_id = agentPageId;
        
        if (newFormId) {
            if (!newSpec.link_data) newSpec.link_data = {};
            if (!newSpec.link_data.call_to_action) newSpec.link_data.call_to_action = { type: 'LEARN_MORE', value: {} };
            newSpec.link_data.call_to_action.value.lead_gen_form_id = newFormId;
        }

        const creativePayload = {
            name: `Creative - ${property.title}`,
            object_story_spec: newSpec,
            access_token: agentToken
        };
        
        const creatRes = await fetch(`${FB_MARKETING_URL}/${agentAdAccount}/adcreatives`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creativePayload)
        });
        const creative = await creatRes.json();
        if (creative.error) throw new Error(`Creative Error: ${creative.error.message}`);
        log("CREATIVE_CREATED", creative.id)


        // 4. Create Ad (Strict Mode)
        const adPayload: any = {
            name: `Ad - ${property.title}`,
            adset_id: adSet.id,
            creative: { creative_id: creative.id },
            status: 'PAUSED',
            access_token: agentToken
        }
        
        const adRes = await fetch(`${FB_MARKETING_URL}/${agentAdAccount}/ads`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adPayload)
        });
        const ad = await adRes.json();

        // 🛑 STOP AND ROLLBACK IF AD CREATION FAILS 🛑
        if (ad.error) {
             log("AD_CREATION_FAILED", ad.error);
             
             // --- ERROR ANALYSIS ---
             const code = ad.error.code;
             const subcode = ad.error.error_subcode;
             const msg = ad.error.message;

             // 1. Payment Error
             const isPaymentIssue = subcode === 1359188 || msg.includes('Payment') || msg.includes('payment');
             
             // 2. Security / Authentication Error (The one you just got)
             const isSecurityIssue = code === 31 || subcode === 3858385 || msg.includes('take a pending action') || msg.includes('authenticate');

             // Trigger Rollback
             if (createdCampaignId) {
                 log("ROLLBACK", `Deleting Campaign ${createdCampaignId}...`);
                 await fetch(`${FB_MARKETING_URL}/${createdCampaignId}?access_token=${agentToken}`, { method: 'DELETE' });
             }

             if (isPaymentIssue) {
                 throw new Error("Payment Method Missing: The system deleted your draft. Please add a Card in Facebook Billing.");
             } else if (isSecurityIssue) {
                 throw new Error("Facebook Security Check: Facebook requires you to verify your identity. Please log into Ads Manager to fix this.");
             } else {
                 throw new Error(`Ad Error: ${msg}. (System rolled back changes)`);
             }
        }
        
        log("AD_CREATED", ad.id)


        // --- SUCCESS RECORDING ---
        const xpEarned = Math.floor(dailyBudgetINR / 10); 
        await supabase.from('profiles').update({ total_xp: (agentProfile.total_xp || 0) + xpEarned }).eq('id', user.id);
        
        await supabase.from('campaigns').insert({
            user_id: user.id,
            meta_campaign_id: campaign.id,
            meta_adset_id: adSet.id,
            meta_ad_id: ad.id,
            name: `[APP] ${property.title}`,
            total_budget: dailyBudgetINR,
            status: 'PAUSED',
            budget_type: 'DAILY'
        });

        await sendNotification(supabase, user.id, "Campaign Created! 🚀", `Campaign initialized.`, "system");

        return NextResponse.json({ success: true, message: "Campaign created successfully!" });

    } catch (error: any) {
        log("FATAL_ERROR", error.message || error)
        
        // Final Safety Rollback
        if (createdCampaignId) {
             try {
                // We won't auto-delete here to be safe unless we are sure it's trash.
             } catch(e) {}
        }

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}