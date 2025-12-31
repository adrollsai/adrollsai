import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getOrgAdminCredentials } from '@/utils/org-helper'
import fs from 'fs'
import path from 'path'

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0"
const LOG_FILE_PATH = path.join(process.cwd(), 'meta_ads_debug.txt');

// --- LOGGER HELPER ---
function logToFile(tag: string, data?: any) {
    try {
        const timestamp = new Date().toISOString();
        const content = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
        const logEntry = `\n[${timestamp}] [${tag}] ${content || ''}\n------------------------------------------------\n`;
        fs.appendFileSync(LOG_FILE_PATH, logEntry);
        // Print key errors to console
        if (tag.includes('FAIL') || tag.includes('ERROR')) console.error(`[${tag}]`, content);
        else console.log(`[${tag}] Data logged.`); 
    } catch (e) { console.error("Log failed", e); }
}

export async function POST(request: Request) {
    // 1. Clear log
    try { fs.writeFileSync(LOG_FILE_PATH, ''); } catch (e) {}
    
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 2. Get Agent & Org Info
    const { data: agentProfile } = await supabase.from('profiles').select('organization_id, role, ad_credits').eq('id', user.id).single();
    if (!agentProfile?.organization_id) return NextResponse.json({ error: 'No Org' }, { status: 400 });

    const formData = await request.formData();
    const propertyId = formData.get('propertyId')?.toString();
    const dailyBudgetINR = parseFloat(formData.get('dailyBudgetINR')?.toString() || '0'); 

    // 3. Get Org Admin Credentials
    let creds;
    try {
        creds = await getOrgAdminCredentials(agentProfile.organization_id);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const { adAccountId, facebookToken, pageId } = creds;

    // 4. Credit Check
    if (agentProfile.role === 'agent' && (agentProfile.ad_credits || 0) < dailyBudgetINR) {
        return NextResponse.json({ error: 'Insufficient Credits' }, { status: 402 });
    }
    
    // Deduct Credits
    await supabase.from('profiles').update({ ad_credits: (agentProfile.ad_credits - dailyBudgetINR) }).eq('id', user.id);

    try {
        // 5. Fetch Project & Template
        const { data: property } = await supabase.from('properties').select('*').eq('id', propertyId).single();
        if (!property?.template_adset_id) throw new Error("This project is not linked to an Ad Template yet.");

        const templateAdSetId = property.template_adset_id;
        logToFile("INFO", `Starting Clone for Property: ${property.title}`);

        // --- A. READ TEMPLATE DATA ---
        // Fetch Ad Set Targeting
        const adSetFetch = await fetch(`${FB_MARKETING_URL}/${templateAdSetId}?fields=name,targeting&access_token=${facebookToken}`);
        const templateAdSet = await adSetFetch.json();
        if (templateAdSet.error) throw new Error(`Template Read Error: ${templateAdSet.error.message}`);
        
        // Fetch Ad & Creative ID
        const adsFetch = await fetch(`${FB_MARKETING_URL}/${templateAdSetId}/ads?fields=creative&limit=1&access_token=${facebookToken}`);
        const adsData = await adsFetch.json();
        if(!adsData.data?.[0]) throw new Error("Template AdSet has no Ads to copy.");
        const templateCreativeId = adsData.data[0].creative.id;

        // Fetch Creative Details & Form ID
        const creativeFetch = await fetch(`${FB_MARKETING_URL}/${templateCreativeId}?fields=object_story_spec&access_token=${facebookToken}`);
        const templateCreative = await creativeFetch.json();
        const oldFormId = templateCreative.object_story_spec?.link_data?.call_to_action?.value?.lead_gen_form_id;
        
        // --- B. DUPLICATE LEAD FORM ---
        let newFormId = oldFormId; 
        if (oldFormId) {
            const formFetch = await fetch(`${FB_MARKETING_URL}/${oldFormId}?fields=name,questions,privacy_policy,context_card,follow_up_action_url&access_token=${facebookToken}`);
            const oldForm = await formFetch.json();
            
            if (!oldForm.error) {
                const newFormPayload = {
                    name: `${oldForm.name} - ${Date.now()}`,
                    questions: oldForm.questions,
                    privacy_policy: oldForm.privacy_policy,
                    follow_up_action_url: oldForm.follow_up_action_url,
                    access_token: facebookToken
                };
                const formCreate = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newFormPayload)
                });
                const formResult = await formCreate.json();
                if (formResult.id) newFormId = formResult.id;
            }
        }

        // --- C. CREATE DEDICATED CAMPAIGN ---
        const campaignPayload = {
            name: `[AGT] ${user.id.slice(0,4)} - ${property.title} - ${Date.now()}`,
            objective: 'OUTCOME_LEADS',
            status: 'PAUSED',
            buying_type: 'AUCTION',
            daily_budget: dailyBudgetINR * 100, 
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP', 
            special_ad_categories: ['HOUSING'], 
            special_ad_category_country: ['IN'],
            access_token: facebookToken,
        };

        const campaignRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/campaigns`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campaignPayload)
        });
        const campaignData = await campaignRes.json();
        
        if (campaignData.error) {
            logToFile("CAMPAIGN_FAIL", campaignData.error);
            throw new Error(`Campaign Creation Failed: ${campaignData.error.message}`);
        }
        const campaignId = campaignData.id;

        // --- D. CREATE AD SET ---
        const startTime = new Date(Date.now() + 10 * 60 * 1000).toISOString(); 

        const baseAdSetPayload: any = {
            campaign_id: campaignId,
            status: 'PAUSED',
            start_time: startTime,
            promoted_object: { page_id: pageId },
            
            // --- CRITICAL FIX: ADD 'destination_type' ---
            destination_type: 'ON_AD', 
            
            billing_event: 'IMPRESSIONS', 
            optimization_goal: 'LEAD_GENERATION', 
            access_token: facebookToken
        };

        // Construct Targeting
        const riskyTargeting = {
            geo_locations: templateAdSet.targeting?.geo_locations || { countries: ['IN'] },
            flexible_spec: templateAdSet.targeting?.flexible_spec 
        };
        if(riskyTargeting.geo_locations?.location_types) {
             delete riskyTargeting.geo_locations.location_types;
        }

        // Try 1: Template Targeting
        let adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                ...baseAdSetPayload,
                name: `AdSet - ${templateAdSet.name}`,
                targeting: riskyTargeting
            })
        });
        let newAdSet = await adSetRes.json();

        // Try 2: Fail-Safe Retry
        if (newAdSet.error) {
            logToFile("ADSET_RETRY", "Template Targeting failed. Retrying with BARE MINIMUM.");
            const safeTargeting = { geo_locations: { countries: ['IN'] } }; 
            adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ 
                    ...baseAdSetPayload,
                    name: `AdSet - Fallback`,
                    targeting: safeTargeting
                })
            });
            newAdSet = await adSetRes.json();
        }

        if (newAdSet.error) {
            logToFile("ADSET_CRITICAL_FAIL", newAdSet.error);
            throw new Error(`AD SET FAILED: ${newAdSet.error.message}`);
        }
        
        const newAdSetId = newAdSet.id;
        
        // --- E. CREATE CREATIVE ---
        const newCreativePayload = {
            name: `Creative - ${Date.now()}`,
            object_story_spec: templateCreative.object_story_spec,
            access_token: facebookToken
        };
        if (newCreativePayload.object_story_spec?.link_data?.call_to_action?.value && newFormId) {
            newCreativePayload.object_story_spec.link_data.call_to_action.value.lead_gen_form_id = newFormId;
        }

        const creativeRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adcreatives`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCreativePayload)
        });
        const newCreative = await creativeRes.json();
        
        if (newCreative.error) {
            logToFile("CREATIVE_FAIL", newCreative.error);
            throw new Error(`Creative Failed: ${newCreative.error.message}`);
        }

        // --- F. CREATE FINAL AD ---
        const adPayload = {
            name: `Ad - Agent ${user.id.slice(0,4)}`,
            adset_id: newAdSetId,
            creative: { creative_id: newCreative.id },
            status: 'PAUSED',
            access_token: facebookToken
        };
        
        const adRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/ads`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adPayload)
        });
        const newAd = await adRes.json();
        
        if (newAd.error) {
            logToFile("AD_FAIL", newAd.error);
            throw new Error(`Ad Creation Failed: ${newAd.error.message}`);
        }

        // --- G. SAVE TO DB ---
        await supabase.from('campaigns').insert({
            user_id: user.id,
            meta_campaign_id: campaignId,
            meta_adset_id: newAdSetId,
            meta_ad_id: newAd.id,
            name: campaignPayload.name,
            total_budget: dailyBudgetINR,
            status: 'PAUSED'
        });

        await supabase.from('transactions').insert({
            user_id: user.id,
            amount: dailyBudgetINR * 100,
            status: 'SUCCESS',
            type: 'DEBIT',
            description: `Ad Run: ${property.title}`,
            order_id: `SPEND_${Date.now()}`
        });

        return NextResponse.json({ success: true, message: "Campaign Launched Successfully!" });

    } catch (error: any) {
        logToFile("CRITICAL_ERROR", error);
        // Refund Logic
        const { data: curr } = await supabase.from('profiles').select('ad_credits').eq('id', user.id).single();
        await supabase.from('profiles').update({ ad_credits: (curr?.ad_credits || 0) + dailyBudgetINR }).eq('id', user.id);
        
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}