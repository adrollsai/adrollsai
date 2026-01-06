// adrollsai/adrollsai/adrollsai-builder-app-lander-feed-notifications/app/api/meta-ads/launch-campaign/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getOrgAdminCredentials } from '@/utils/org-helper'
import { sendNotification } from '@/utils/notification-helper'
import fs from 'fs'
import path from 'path'

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0"
const LOG_FILE_PATH = path.join(process.cwd(), 'meta_ads_debug.txt');

function logToFile(tag: string, data?: any) {
    try {
        const timestamp = new Date().toISOString();
        const content = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
        const logEntry = `\n[${timestamp}] [${tag}] ${content || ''}\n------------------------------------------------\n`;
        fs.appendFileSync(LOG_FILE_PATH, logEntry);
        if (tag.includes('FAIL') || tag.includes('ERROR')) console.error(`[${tag}]`, content);
    } catch (e) { console.error("Log failed", e); }
}

export async function POST(request: Request) {
    try { fs.writeFileSync(LOG_FILE_PATH, ''); } catch (e) {}
    
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: agentProfile } = await supabase.from('profiles').select('organization_id, role, ad_credits, total_xp, level').eq('id', user.id).single();
    if (!agentProfile?.organization_id) return NextResponse.json({ error: 'No Org' }, { status: 400 });

    const formData = await request.formData();
    const propertyId = formData.get('propertyId')?.toString();
    const budgetInput = formData.get('lifetimeBudgetINR') || formData.get('dailyBudgetINR');
    const lifetimeBudgetINR = parseFloat(budgetInput?.toString() || '0'); 

    let creds;
    try {
        creds = await getOrgAdminCredentials(agentProfile.organization_id);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const { adAccountId, facebookToken, pageId } = creds;

    if (agentProfile.role === 'agent' && (agentProfile.ad_credits || 0) < lifetimeBudgetINR) {
        return NextResponse.json({ error: 'Insufficient Credits' }, { status: 402 });
    }
    
    // Deduct Credits
    await supabase.from('profiles').update({ ad_credits: (agentProfile.ad_credits || 0) - lifetimeBudgetINR }).eq('id', user.id);

    try {
        const { data: property } = await supabase.from('properties').select('*').eq('id', propertyId).single();
        if (!property?.template_adset_id) throw new Error("This project is not linked to an Ad Template yet.");

        const templateAdSetId = property.template_adset_id;

        // --- Facebook API Calls (Abbreviated for clarity, logic remains same) ---
        const adSetFetch = await fetch(`${FB_MARKETING_URL}/${templateAdSetId}?fields=name,targeting&access_token=${facebookToken}`);
        const templateAdSet = await adSetFetch.json();
        if (templateAdSet.error) throw new Error(`Template Read Error: ${templateAdSet.error.message}`);
        
        const adsFetch = await fetch(`${FB_MARKETING_URL}/${templateAdSetId}/ads?fields=creative&limit=1&access_token=${facebookToken}`);
        const adsData = await adsFetch.json();
        if(!adsData.data?.[0]) throw new Error("Template AdSet has no Ads to copy.");
        const templateCreativeId = adsData.data[0].creative.id;

        const creativeFetch = await fetch(`${FB_MARKETING_URL}/${templateCreativeId}?fields=object_story_spec&access_token=${facebookToken}`);
        const templateCreative = await creativeFetch.json();
        const oldFormId = templateCreative.object_story_spec?.link_data?.call_to_action?.value?.lead_gen_form_id;
        
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

        const campaignPayload = {
            name: `[AGT] ${user.id.slice(0,4)} - ${property.title} - ${Date.now()}`,
            objective: 'OUTCOME_LEADS',
            status: 'PAUSED',
            buying_type: 'AUCTION',
            lifetime_budget: lifetimeBudgetINR * 100, 
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP', 
            special_ad_categories: ['HOUSING'], 
            special_ad_category_country: ['IN'],
            access_token: facebookToken,
        };

        const campaignRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/campaigns`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campaignPayload)
        });
        const campaignData = await campaignRes.json();
        if (campaignData.error) throw new Error(`Campaign Creation Failed: ${campaignData.error.message}`);
        const campaignId = campaignData.id;

        const startTime = new Date(Date.now() + 15 * 60 * 1000); 
        const endTime = new Date(startTime.getTime() + 30 * 24 * 60 * 60 * 1000); 

        const baseAdSetPayload: any = {
            campaign_id: campaignId,
            status: 'PAUSED',
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(), 
            promoted_object: { page_id: pageId },
            destination_type: 'ON_AD', 
            billing_event: 'IMPRESSIONS', 
            optimization_goal: 'LEAD_GENERATION', 
            access_token: facebookToken
        };

        const riskyTargeting = {
            geo_locations: templateAdSet.targeting?.geo_locations || { countries: ['IN'] },
            flexible_spec: templateAdSet.targeting?.flexible_spec 
        };
        if(riskyTargeting.geo_locations?.location_types) delete riskyTargeting.geo_locations.location_types;

        let adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ ...baseAdSetPayload, name: `AdSet - ${templateAdSet.name}`, targeting: riskyTargeting })
        });
        let newAdSet = await adSetRes.json();

        if (newAdSet.error) {
            const safeTargeting = { geo_locations: { countries: ['IN'] } }; 
            adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ ...baseAdSetPayload, name: `AdSet - Fallback`, targeting: safeTargeting })
            });
            newAdSet = await adSetRes.json();
        }
        if (newAdSet.error) throw new Error(`AD SET FAILED: ${newAdSet.error.message}`);
        
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
        if (newCreative.error) throw new Error(`Creative Failed: ${newCreative.error.message}`);

        const adPayload = {
            name: `Ad - Agent ${user.id.slice(0,4)}`,
            adset_id: newAdSet.id,
            creative: { creative_id: newCreative.id },
            status: 'PAUSED',
            access_token: facebookToken
        };
        
        const adRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/ads`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adPayload)
        });
        const newAd = await adRes.json();
        if (newAd.error) throw new Error(`Ad Creation Failed: ${newAd.error.message}`);

        // --- XP AWARD LOGIC (1 XP = 1 INR) ---
        const xpEarned = Math.floor(lifetimeBudgetINR);
        const newXp = (agentProfile.total_xp || 0) + xpEarned;
        const newLevel = Math.floor(newXp / 1000) + 1;

        await supabase.from('profiles').update({ total_xp: newXp, level: newLevel }).eq('id', user.id);
        
        await supabase.from('campaigns').insert({
            user_id: user.id,
            meta_campaign_id: campaignId,
            meta_adset_id: newAdSet.id,
            meta_ad_id: newAd.id,
            name: campaignPayload.name,
            total_budget: lifetimeBudgetINR,
            status: 'PAUSED',
            budget_type: 'LIFETIME'
        });

        await supabase.from('transactions').insert({
            user_id: user.id,
            amount: lifetimeBudgetINR * 100,
            status: 'SUCCESS',
            type: 'DEBIT',
            order_id: `SPEND_${Date.now()}`
        });

        // Notify XP
        await sendNotification(supabase, user.id, "Campaign Launched! 🚀", `Ads are live. You earned +${xpEarned} XP for your budget!`, "system");

        return NextResponse.json({ success: true, message: "Campaign Launched Successfully!" });

    } catch (error: any) {
        logToFile("CRITICAL_ERROR", error);
        // Refund
        const { data: curr } = await supabase.from('profiles').select('ad_credits').eq('id', user.id).single();
        await supabase.from('profiles').update({ ad_credits: (curr?.ad_credits || 0) + lifetimeBudgetINR }).eq('id', user.id);
        
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}