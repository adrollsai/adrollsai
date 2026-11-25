import { META_GRAPH_URL } from '@/lib/ads/graph-version'
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/utils/supabase/server';
import { generateKieChat, createKieImageTask, callGemini } from '@/utils/external-apis';
import { checkLimitAndIncrement, refundLimit } from '@/utils/subscription-server';
import { MEDIA_MODELS } from '@/lib/agent/media-models';
import { analyseCreatives } from '@/lib/ads/creative-performance';

const FB_GRAPH = META_GRAPH_URL;

export async function POST(request: Request) {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    console.log("[Optimize] Request Body:", JSON.stringify(body, null, 2));
    const { campaignId, step = 'analyze', variations: requestedVariations, winningImageUrls: passedWinningImages, count = 5, style = 'hyper', userInstructions = '' } = body;
    if (!campaignId) return NextResponse.json({ error: 'Missing Campaign ID' }, { status: 400 });
    let targetUserId = user.id;

    try {
        // --- 0. Resolve Target User ID ---
        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');
        const { data: ownProfile } = await supabase.from('profiles').select('role, facebook_token, parent_id, agency_id').eq('id', user.id).single();
        targetUserId = user.id;

        if (ownProfile?.role === 'agent' && (ownProfile?.parent_id || ownProfile?.agency_id)) {
            targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
        }

        if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
            if (ownProfile?.role !== 'super_admin') {
                const isParent = (ownProfile?.agency_id === impersonateId || ownProfile?.parent_id === impersonateId);
                const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', ownProfile?.agency_id || user.id).single();
                if (isParent || subAccount) {
                    targetUserId = impersonateId;
                }
            } else {
                targetUserId = impersonateId;
            }
        }

        console.log("[Optimize] Authenticated User:", user.id);
        console.log("[Optimize] Resolved Target User:", targetUserId);

        // --- SUBSCRIPTION CHECK ---
        try {
            await checkLimitAndIncrement(targetUserId, 'campaign_optimizations');
        } catch (limitErr: any) {
            return NextResponse.json({ error: limitErr.message }, { status: 403 });
        }

        // Use admin client to bypass RLS for impersonated accounts
        const { createClient: createAdminClient } = await import('@supabase/supabase-js');
        const supabaseAdmin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        let { data: profile, error: profileErr } = await supabaseAdmin.from('profiles')
            .select('facebook_token, ad_account_id, business_name, logo_url, contact_number, agency_id, parent_id')
            .eq('id', targetUserId)
            .single();
        
        if (profileErr) {
            console.error("[Optimize] Supabase Profile Error:", profileErr);
        }

        let token = profile?.facebook_token;
        if (!token) {
            token = ownProfile?.facebook_token;
        }

        if (!token && (ownProfile?.agency_id || ownProfile?.parent_id)) {
            const { data: parentProfile } = await supabase
                .from('profiles')
                .select('facebook_token')
                .eq('id', ownProfile.agency_id || ownProfile.parent_id)
                .single();
            token = parentProfile?.facebook_token;
        }

        if (profile) {
            profile.facebook_token = token || null;
        }

        if (!profile?.facebook_token || !profile?.ad_account_id) {
            console.error("[Optimize] Profile Error: Missing tokens for targetUserId:", targetUserId, "Profile found?", !!profile);
            return NextResponse.json({ error: 'Missing Meta credentials. Please ensure your Meta account is linked.' }, { status: 400 });
        }

        // Fetch the campaign name from Meta Graph API to match it with the correct property
        let campaignName = body.campaignName || "";
        if (campaignId) {
            try {
                const compRes = await fetch(`${FB_GRAPH}/${campaignId}?fields=name&access_token=${profile.facebook_token}`);
                if (compRes.ok) {
                    const compData = await compRes.json();
                    if (compData.name) {
                        campaignName = compData.name;
                    }
                }
            } catch (e: any) {
                console.error("[Optimize] Failed to fetch campaign name:", e.message);
            }
        }

        // Fetch properties for the user to find the matched one
        let realPropId = null;
        let matchedProperty = null;
        try {
            if (body.propertyId) {
                const { data: prop } = await supabaseAdmin
                    .from('properties')
                    .select('id, title, description')
                    .eq('id', body.propertyId)
                    .single();
                if (prop) {
                    matchedProperty = prop;
                    realPropId = prop.id;
                }
            }

            if (!matchedProperty) {
                const { data: properties } = await supabaseAdmin
                    .from('properties')
                    .select('id, title, description')
                    .eq('user_id', targetUserId);
                
                if (properties && properties.length > 0) {
                    if (campaignName) {
                        matchedProperty = properties.find(p => 
                            p.title && campaignName.toLowerCase().includes(p.title.toLowerCase())
                        );
                    }
                    // Fallback to first property if no direct title match
                    if (!matchedProperty) {
                        matchedProperty = properties[0];
                    }
                    realPropId = matchedProperty.id;
                }
            }
        } catch (e: any) {
            console.error("[Optimize] Failed to fetch/match property:", e.message);
        }

        if (step === 'analyze') {
            /**
             * Read what the creatives DID, on one window, and judge them before asking a model
             * anything. Two things in the old version made the analysis meaningless:
             *   - `date_preset=maximum` compared lifetime totals, so the creative that has been
             *     running for six months beat the one working this week;
             *   - it borrowed `spend, impressions, cpc` only, so cost per enquiry — the number the
             *     owner actually acts on — could not be computed at all, and ranking fell back to
             *     spend, which puts the expensive loser at the top.
             * The judgement itself now lives in lib/ads/creative-performance.ts, with the same
             * 1,000-impression / ₹500 thresholds the rest of the product uses.
             */
            const windowPreset = String((body as any)?.datePreset || 'last_30d');
            const windowLabel = windowPreset === 'last_7d' ? 'the last 7 days'
                : windowPreset === 'last_14d' ? 'the last 14 days'
                : windowPreset === 'last_90d' ? 'the last 90 days'
                : windowPreset === 'maximum' ? 'all time'
                : 'the last 30 days';

            const insightFields = 'ad_id,ad_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type';
            const insightsRes = await fetch(
                `${FB_GRAPH}/${campaignId}/insights?fields=${insightFields}&level=ad&date_preset=${windowPreset}&access_token=${profile.facebook_token}`
            );
            const insightsData = await insightsRes.json();

            if (!insightsData.data || insightsData.data.length === 0) {
                return NextResponse.json({ 
                    status: 'insufficient_data', 
                    message: 'This campaign does not have enough active delivery data to optimize yet.' 
                });
            }

            // Creatives for every ad that delivered — not just five — so the ranking can name what
            // the numbers belong to instead of showing spend against an id.
            const allAdIds = insightsData.data.map((ad: any) => ad.ad_id).filter(Boolean);
            const adsMap: Record<string, any> = {};
            try {
                const adsRes = await fetch(
                    `${FB_GRAPH}/?ids=${allAdIds.slice(0, 50).join(',')}&fields=id,name,creative{id,image_url,thumbnail_url,video_id,object_story_spec}&access_token=${profile.facebook_token}`
                );
                const adsDataRaw = await adsRes.json();
                Object.values(adsDataRaw || {}).forEach((ad: any) => {
                    if (!ad?.id) return;
                    const link = ad.creative?.object_story_spec?.link_data;
                    adsMap[ad.id] = {
                        name: ad.name,
                        imageUrl: ad.creative?.image_url || ad.creative?.thumbnail_url,
                        headline: link?.name,
                        primaryText: link?.message,
                        leadFormId: link?.call_to_action?.value?.lead_gen_form_id,
                        isVideo: Boolean(ad.creative?.video_id)
                    };
                });
            } catch (creativeErr: any) {
                // Missing thumbnails degrade the report; they must not fail the analysis.
                console.warn('[Optimize] creative details unavailable:', creativeErr?.message);
            }

            const enrichedRows = insightsData.data.map((ad: any) => {
                const creative = adsMap[ad.ad_id] || {};
                return {
                    ...ad,
                    imageUrl: creative.imageUrl ?? null,
                    headline: creative.headline ?? null,
                    primaryText: creative.primaryText ?? null,
                    isVideo: creative.isVideo ?? false
                };
            });

            const analysis = analyseCreatives(enrichedRows, { window: windowLabel });

            // Only creatives worth evolving become reference images. Feeding losers back in as
            // "visual DNA" is how an account ends up with six expensive variations of the ad that
            // was already losing.
            const winningImageUrls = Array.from(
                new Set(
                    [...analysis.winners, ...analysis.creatives.filter((c) => c.verdict === 'average')]
                        .map((c) => c.imageUrl)
                        .filter(Boolean)
                )
            ) as string[];

            const leadFormId = Object.values(adsMap).find((a: any) => a.leadFormId)?.leadFormId;

            const llmPrompt = `
            PERSONA: World-class AI Creative Director & Media Buying Strategist (20+ years exp).
            OBJECTIVE: The measured performance of this campaign's creatives is below. Architect 6 "High-Value" Meta Ad variations that evolve the WINNERS and deliberately do not repeat the losers.

            USER STRATEGY NOTES: ${userInstructions || 'None'}
            USER PREFERRED STYLE: ${style}

            WHAT THE DATA SAYS (${analysis.window}):
            ${analysis.summary}

            TOTALS: spend ${analysis.totals.spendPaise / 100}, enquiries ${analysis.totals.results}, cost per enquiry ${analysis.totals.costPerResultPaise !== null ? analysis.totals.costPerResultPaise / 100 : 'unknown'}, judged creatives ${analysis.totals.judged}, too early to judge ${analysis.totals.unjudged}.

            VERDICT PER CREATIVE:
            ${JSON.stringify(
                analysis.creatives.map((c) => ({
                    name: c.adName,
                    verdict: c.verdict,
                    spend: c.spendPaise / 100,
                    impressions: c.impressions,
                    clicks: c.clicks,
                    ctr_pct: c.ctrPct,
                    enquiries: c.results,
                    cost_per_enquiry: c.costPerResultPaise !== null ? c.costPerResultPaise / 100 : null,
                    headline: c.headline,
                    primary_text: c.primaryText,
                    why: c.why
                })),
                null,
                2
            )}

            TASK:
            1. Say what the winning creatives have in common that the losers do not — cite the numbers.
            2. Name the one change most likely to lower cost per enquiry next.
            3. Suggest 6 brand new variations that evolve the winners.
            Do not claim a creative won if its verdict is "loser" or "too_early".

            IMAGE PROMPT GUIDELINES (FOR VARIATIONS):
            - HYPER-REALISM: professional photographs from a high-end camera. No "AI sheen".
            - BRIGHT NATURAL LIGHTING: bright, airy, clean; high-exposure natural morning sunlight and clear skies. Do not suggest golden hour, twilight, sunset, evening or dark interior glow unless the strategy notes ask for it.
            - PEOPLE: close-up portrait shots (chest up or head-and-shoulders) of photorealistic, happy, smiling people in the foreground, with the property/building clearly recognizable behind them (soft bokeh). Skin must look real — pores, natural detail; no plastic or airbrushed look. No tiny or distant figures.
            - ETHNICITY: match the business context (${profile.business_name || 'Global'}).
            - TYPOGRAPHY: clear, clean overlays — a benefit-led headline, a sub-headline with specs/price, the business logo and contact. Include the city/location when the product details give it; never invent one.
            - HOOK & HIERARCHY: a visual hook that stops the scroll.
            - VISUAL CONSISTENCY: keep architecture close to the supplied property photos; no fantasy buildings.

            IMPORTANT: Use the winning visuals (${winningImageUrls.length} provided) as your "Visual DNA".
            
            OUTPUT VALID JSON:
            {
                "insight": "...",
                "suggested_variations": [
                    { "title": "Angle 1", "image_prompt": "...", "headline": "...", "primary_text": "...", "description": "...", "social_caption": "..." },
                    ...
                ]
            }
            `;

            const aiRaw = await callGemini(llmPrompt, winningImageUrls); // Using the official Gemini SDK with all images
            
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
                winningImageUrls,
                leadFormId,
                // The measured half, so the UI can show the numbers rather than only the model's prose.
                analysis
            });
        }

        if (step === 'generate') {
            // Robust baseUrl for local/production loopback
            const host = request.headers.get('host') || 'localhost:3000';
            const isLocal = host.includes('localhost') || host.includes('local.nobogent.com') || host.includes('127.0.0.1');
            const baseUrl = isLocal ? 'http://127.0.0.1:3000' : `https://${host}`;
            
            const batchId = crypto.randomUUID();

            for (let i = 0; i < requestedVariations.length; i++) {
                const variant = requestedVariations[i];
                const modelToUse = MEDIA_MODELS.image.id;
                const aspectRatio = '3:4';
                
                const cookieHeader = request.headers.get('cookie') || '';
                
                // Pass winning images as reference to the first few variations
                const referenceImages = i < 3 ? (passedWinningImages || []) : [];

                const workerUrl = impersonateId ? `${baseUrl}/api/background-worker?impersonate=${impersonateId}` : `${baseUrl}/api/background-worker`;

                fetch(workerUrl, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Cookie': cookieHeader
                    },
                    body: JSON.stringify({
                        userId: targetUserId,
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
                            propImages: referenceImages,
                            socialCaption: variant.social_caption
                        },
                        existingCaption: `${variant.headline}\n\n${variant.primary_text}${variant.description ? `\n\n${variant.description}` : ''}`
                    })
                }).catch(err => console.error("Worker trigger failed:", err));
            }

            return NextResponse.json({ status: 'success', batchId });
        }

        if (step === 'generate-copy') {
            const { imageUrls = [], captions = [] } = body;
            
            let propertyContext = "";
            if (matchedProperty) {
                propertyContext = `
                Product/Property Info:
                Title: ${matchedProperty.title}
                Description: ${matchedProperty.description}
                `;
            }

            const llmPrompt = `
            Act as an elite direct-response marketer. Craft exactly ONE (1) distinct, highly persuasive ad copy variation for a campaign named "${campaignName}".
            
            ${propertyContext}
            
            Business Context:
            Name: ${profile.business_name || 'Our Company'}
            Contact: ${profile.contact_number || 'Contact Us'}
            Existing Captions (Context): ${captions ? captions.join(' | ') : 'None provided'}
            
            ${userInstructions ? `Custom Copywriting Instructions (MUST FOLLOW STRICTLY):\n"${userInstructions}"\n` : ''}

            CRITICAL RULES:
            1. Apply Alex Hormozi's marketing frameworks: Emphasize "Value Stacking", create "Grand Slam Offers", use risk reversal, and write strong, emotionally resonant hooks.
            2. MANDATORY: YOU MUST ALWAYS INCLUDE THE BUSINESS NAME (${profile.business_name || 'Our Company'}) AND CONTACT INFORMATION (${profile.contact_number || 'Contact Us'}) IN EVERY SINGLE VARIATION.
            3. DO NOT include any website URLs, links, or domain names in the primary text or headline.
            4. NO HASHTAGS (#): Do not use any hashtags in the copy.
            5. MODERATE LENGTH: Keep the primary text moderate (max 400 characters).
            6. KEYWORDS: At the very end of each primary_text, add 5-6 relevant keywords in brackets.
            7. AI NAMING: Generate a unique suggested_campaign_name (e.g. "[Topic] - [Angle] - Month Year"), suggested_adset_name (target audience angle), and suggested_ad_name (hook or creative angle).
            8. OUTPUT FORMAT: Return ONLY a valid JSON object.
            
            JSON Structure:
            {
              "suggested_campaign_name": "...",
              "suggested_adset_name": "...",
              "suggested_ad_name": "...",
              "primary_text": "...",
              "headline": "...",
              "description": "..."
            }
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
        
        // REFUND: Give back the optimization credit if the process failed
        if (targetUserId) {
            await refundLimit(targetUserId, 'campaign_optimizations');
        }

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}