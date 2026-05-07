import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/utils/supabase/server';
import { generateKieChat, createKieImageTask, callGemini } from '@/utils/external-apis';

const FB_GRAPH = "https://graph.facebook.com/v19.0";

export async function POST(request: Request) {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    console.log("[Optimize] Request Body:", JSON.stringify(body, null, 2));
    const { campaignId, step = 'analyze', variations: requestedVariations, winningImageUrls: passedWinningImages, count = 5, style = 'hyper', userInstructions = '' } = body;
    if (!campaignId) return NextResponse.json({ error: 'Missing Campaign ID' }, { status: 400 });

    try {
        console.log("[Optimize] User ID from auth:", user.id);
        const { data: profile, error: profileErr } = await supabase.from('profiles').select('facebook_token, ad_account_id, business_name, logo_url, contact_number').eq('id', user.id).single();
        
        if (profileErr) {
            console.error("[Optimize] Supabase Profile Error:", profileErr);
        }

        if (!profile?.facebook_token || !profile?.ad_account_id) {
            console.error("[Optimize] Profile Error: Missing tokens. Profile found?", !!profile);
            return NextResponse.json({ error: 'Missing Meta credentials' }, { status: 400 });
        }

        // Fetch a real property ID for the user to avoid UUID type errors in Supabase
        const { data: firstProp } = await supabase.from('properties').select('id').eq('user_id', user.id).limit(1).single();
        console.log("[Optimize] Property ID found:", firstProp?.id);
        const realPropId = firstProp?.id || null;

        if (step === 'analyze') {
            // 1. Fetch Ad-Level Insights
            const insightsRes = await fetch(`${FB_GRAPH}/${campaignId}/insights?fields=ad_id,ad_name,spend,impressions,cpc,actions&level=ad&date_preset=maximum&access_token=${profile.facebook_token}`);
            const insightsData = await insightsRes.json();
            
            if (!insightsData.data || insightsData.data.length === 0) {
                return NextResponse.json({ 
                    status: 'insufficient_data', 
                    message: 'This campaign does not have enough active delivery data to optimize yet.' 
                });
            }

            // 1b. Sort by performance (Leads > Spend) and pick top 5
            const topAdInsights = [...insightsData.data]
                .sort((a: any, b: any) => {
                    const leadsA = parseInt(a.actions?.find((act: any) => act.action_type === 'lead')?.value || "0");
                    const leadsB = parseInt(b.actions?.find((act: any) => act.action_type === 'lead')?.value || "0");
                    if (leadsB !== leadsA) return leadsB - leadsA;
                    return parseFloat(b.spend || "0") - parseFloat(a.spend || "0");
                })
                .slice(0, 5);
            
            const topAdIds = topAdInsights.map((ad: any) => ad.ad_id);

            // 2. Fetch Creative Details for ONLY Top Performing Ads
            const adsRes = await fetch(`${FB_GRAPH}/?ids=${topAdIds.join(',')}&fields=id,name,creative{id,image_url,thumbnail_url,object_story_spec,video_id}&access_token=${profile.facebook_token}`);
            const adsDataRaw = await adsRes.json();
            const adsData = { data: Object.values(adsDataRaw) as any[] };
            
            const adsMap: Record<string, any> = {};
            if (adsData.data) {
                adsData.data.forEach((ad: any) => {
                    // Skip if it's a video ad
                    if (ad.creative?.video_id) return;

                    adsMap[ad.id] = {
                        name: ad.name,
                        imageUrl: ad.creative?.image_url || ad.creative?.thumbnail_url,
                        headline: ad.creative?.object_story_spec?.link_data?.name,
                        primaryText: ad.creative?.object_story_spec?.link_data?.message,
                        leadFormId: ad.creative?.object_story_spec?.link_data?.call_to_action?.value?.lead_gen_form_id
                    };
                });
            }

            const performanceSummary = insightsData.data.map((ad: any) => {
                const creative = adsMap[ad.ad_id] || {};
                const spend = parseFloat(ad.spend || "0");
                const leads = parseInt(ad.actions?.find((a: any) => a.action_type === 'lead')?.value || "0");
                return {
                    ad_id: ad.ad_id,
                    ad_name: ad.ad_name,
                    spend,
                    leads,
                    imageUrl: creative.imageUrl,
                    headline: creative.headline,
                    primaryText: creative.primaryText
                };
            });

            // Identify a lead form to reuse
            const leadFormId = Object.values(adsMap).find((a: any) => a.leadFormId)?.leadFormId;

            // 3. Multimodal Analysis
            const imageUrls = Array.from(new Set(performanceSummary.map((p: any) => p.imageUrl).filter(Boolean))) as string[];
            
            const llmPrompt = `
            You are a world-class AI media buyer. Analyze the performance of these ${performanceSummary.length} ads.
            
            USER STRATEGY NOTES: ${userInstructions || 'None'}
            USER PREFERRED STYLE: ${style}

            AD PERFORMANCE DATA:
            ${JSON.stringify(performanceSummary, null, 2)}
            
            TASK:
            1. Identify which visuals and copy angles are winning (generating leads at low cost).
            2. Identify which ones are failing.
            3. Provide a sharp 2-sentence summary of WHAT works and WHY.
            4. Suggest 6 brand new "Professional High-End Variations" to test next.
            
            IMAGE PROMPT GUIDELINES:
            - Goal: Create industry-standard, professional ad creatives that encapsulate product info beautifully.
            - Style: High-quality photography, premium lighting, state-of-the-art design.
            - People: Include "super beautiful" people that match the ethnicity of the business context (${profile.business_name || 'Global'}).
            - Cleanliness: NO nonsensical elements or AI artifacts.
            
            IMPORTANT: Use the winning visuals (${imageUrls.length} provided) as your "Visual DNA". Your image_prompt should describe how to evolve these winners into premium, attention-grabbing agency-grade creatives.
            
            OUTPUT VALID JSON:
            {
                "insight": "...",
                "suggested_variations": [
                    { "title": "Angle 1", "image_prompt": "...", "headline": "...", "primary_text": "..." },
                    ...
                ]
            }
            `;

            const aiRaw = await callGemini(llmPrompt, imageUrls); // Using the official Gemini SDK with all images
            
            let parsed;
            try {
                // Robust extraction: find the first { and last }
                const jsonMatch = aiRaw.match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error("No JSON block found in AI response");
                parsed = JSON.parse(jsonMatch[0]);
            } catch (jsonErr) {
                console.error("[Optimize] JSON Parse Error. Raw output:", aiRaw);
                return NextResponse.json({ error: "AI strategy format error. Please try again." }, { status: 500 });
            }

            return NextResponse.json({
                status: 'success',
                insight: parsed.insight,
                variations: parsed.suggested_variations,
                winningImageUrls: imageUrls,
                leadFormId
            });
        }

        if (step === 'generate') {
            const baseUrl = new URL(request.url).origin;
            const batchId = crypto.randomUUID();

            for (let i = 0; i < requestedVariations.length; i++) {
                const variant = requestedVariations[i];
                const modelToUse = 'image-2.0';
                const aspectRatio = '1:1';
                
                const cookieHeader = request.headers.get('cookie') || '';
                
                // Pass winning images as reference to the first few variations
                const referenceImages = i < 3 ? (passedWinningImages || []) : [];

                fetch(`${baseUrl}/api/background-worker`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Cookie': cookieHeader
                    },
                    body: JSON.stringify({
                        userId: user.id,
                        propertyTitle: variant.title,
                        propId: realPropId,
                        batchId: batchId,
                        payload: {
                            propertyTitle: variant.title,
                            propertyDescription: variant.image_prompt,
                            userInstructions: `AI Optimization: ${userInstructions}`,
                            model: modelToUse,
                            isOrganic: style === 'organic',
                            aspectRatio: aspectRatio,
                            logoUrl: profile.logo_url,
                            contactNumber: profile.contact_number,
                            propImages: referenceImages
                        },
                        existingCaption: `${variant.headline}\n\n${variant.primary_text}`
                    })
                }).catch(err => console.error("Worker trigger failed:", err));
            }

            return NextResponse.json({ status: 'success', batchId });
        }

        if (step === 'generate-copy') {
            const { imageUrls = [], captions = [], campaignName = "Our Campaign" } = body;
            const llmPrompt = `
            Act as an elite direct-response marketer. Craft exactly ONE (1) distinct, highly persuasive ad copy variation for a campaign named "${campaignName}".
            
            Business Context:
            Name: ${profile.business_name || 'Our Company'}
            Contact: ${profile.contact_number || 'Contact Us'}
            Existing Captions (Context): ${captions ? captions.join(' | ') : 'None provided'}
            
            CRITICAL RULES:
            1. Apply Alex Hormozi's marketing frameworks: Emphasize "Value Stacking", create "Grand Slam Offers", use risk reversal, and write strong, emotionally resonant hooks.
            2. MANDATORY: YOU MUST ALWAYS INCLUDE THE BUSINESS NAME (${profile.business_name || 'Our Company'}) AND CONTACT INFORMATION (${profile.contact_number || 'Contact Us'}) IN EVERY SINGLE VARIATION.
            3. DO NOT include any website URLs, links, or domain names in the primary text or headline.
            4. NO HASHTAGS (#): Do not use any hashtags in the copy.
            5. MODERATE LENGTH: Keep the primary text moderate (max 400 characters).
            6. KEYWORDS: At the very end of each primary_text, add 5-6 relevant keywords in brackets.
            7. OUTPUT FORMAT: Return ONLY a valid JSON object.
            
            JSON Structure:
            {"primary_text": "...", "headline": "..."}
            `;

            const aiRaw = await callGemini(llmPrompt, imageUrls);
            
            let variation;
            try {
                const jsonMatch = aiRaw.match(/\{[\s\S]*\}/);
                variation = JSON.parse(jsonMatch ? jsonMatch[0] : aiRaw);
            } catch (e) {
                console.error("Copy generation parse error:", aiRaw);
                return NextResponse.json({ error: "Failed to parse AI copy variation" }, { status: 500 });
            }

            return NextResponse.json({ status: 'success', variation });
        }

        console.error("[Optimize] Unhandled Step:", step);
        return NextResponse.json({ error: `Invalid Step: ${step}` }, { status: 400 });

    } catch (error: any) {
        console.error("[Optimize] Fatal API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}