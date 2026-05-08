import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { callGemini } from '@/utils/external-apis';
import { checkLimitAndIncrement } from '@/utils/subscription-server';

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

import { logToFile, clearLogFile } from '@/utils/logger';

export async function POST(request: Request) {
    clearLogFile();

    const supabase = await createClient();
    
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json(
            { error: 'Unauthorized' }, 
            { status: 401 }
        );
    }

    // --- SUBSCRIPTION CHECK ---
    try {
        await checkLimitAndIncrement(user.id, 'campaign_launches');
    } catch (limitErr: any) {
        logToFile(`QUOTA ERROR: ${limitErr.message}`);
        return NextResponse.json({ error: limitErr.message }, { status: 403 });
    }

    let data: any = {};
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
        data = await request.json();
    } else {
        const formData = await request.formData();
        data.adAccountId = formData.get('adAccountId')?.toString();
        data.facebookToken = formData.get('facebookToken')?.toString();
        data.metaLocations = formData.get('metaLocations')?.toString();
        data.dailyBudgetINR = parseFloat(formData.get('dailyBudgetINR')?.toString() || '500');
        data.pageId = formData.get('pageId')?.toString();
        data.linkUrl = formData.get('linkUrl')?.toString();
        data.privacyPolicyUrl = formData.get('privacyPolicyUrl')?.toString();
        data.optimizeForConversions = formData.get('optimizeForConversions') === 'true';
        data.customQuestions = formData.get('customQuestions')?.toString();
        data.inventoryIds = formData.getAll('inventoryIds').map(String);
        data.assetIds = formData.getAll('assetIds').map(String);
        
        data.creativeFiles = [];
        formData.forEach((value, key) => {
            if (key.startsWith('creativeFiles[') && value instanceof Blob) {
                data.creativeFiles.push(value);
            }
        });
    }

    // ALWAYS fetch profile to get business name and contact info
    const { data: profile } = await supabase.from('profiles')
        .select('facebook_token, ad_account_id, fb_page_id, business_url, business_name, contact_number')
        .eq('id', user.id)
        .single();

    if (profile) {
        data.facebookToken = data.facebookToken || profile.facebook_token;
        data.adAccountId = data.adAccountId || profile.ad_account_id;
        data.pageId = data.pageId || profile.fb_page_id;
        data.linkUrl = data.linkUrl || profile.business_url;
        data.privacyPolicyUrl = data.privacyPolicyUrl || (profile.business_url ? `${profile.business_url}/privacy` : '');
        data.business_name = profile.business_name;
        data.contact_number = profile.contact_number;
    }

    const {
        facebookToken,
        adAccountId,
        pageId,
        linkUrl,
        privacyPolicyUrl,
        dailyBudgetINR = 500,
        metaLocations: metaLocationsStr,
        optimizeForConversions,
        customQuestions: customQuestionsStr,
        inventoryIds = [],
        assetIds = [],
        creativeFiles = []
    } = data;

    if (!facebookToken || !adAccountId || !pageId) {
        const missing = [];
        if (!facebookToken) missing.push("Facebook Access Token");
        if (!adAccountId) missing.push("Ad Account ID");
        if (!pageId) missing.push("Facebook Page ID");
        
        return NextResponse.json(
            { error: `Meta Ads account not fully connected. Missing: ${missing.join(', ')}. Please update your Profile settings.` }, 
            { status: 400 }
        );
    }

    logToFile("=== STARTING AI CAMPAIGN LAUNCH (MULTI-CREATIVE) ===");

    try {
        // --- Step A: Get Source Data & Context ---
        let combinedContext = "";
        let initialImageUrls: string[] = []; 

        if (data.imageUrl) {
            initialImageUrls.push(data.imageUrl);
        }

        if (inventoryIds.length > 0) {
            const { data: props, error } = await supabase
                .from('properties')
                .select('title, description, images, image_url')
                .in('id', inventoryIds);
            
            if (error) throw new Error("Failed to fetch property details.");
            
            if (props) {
                props.forEach(prop => {
                    combinedContext += `Property: ${prop.title || 'N/A'}. Description: ${prop.description || 'N/A'}. `;
                    if (prop.images && Array.isArray(prop.images) && prop.images.length > 0) {
                        initialImageUrls.push(...prop.images);
                    } else if (prop.image_url) {
                        initialImageUrls.push(prop.image_url);
                    }
                });
            }
        } 
        
        if (assetIds.length > 0) {
             const { data: assets } = await supabase
                .from('assets')
                .select('url')
                .in('id', assetIds);

             if (assets) {
                 assets.forEach(asset => {
                     if (asset.url) initialImageUrls.push(asset.url);
                 });
             }
        }

        if (creativeFiles.length === 0 && initialImageUrls.length === 0) {
            throw new Error("No images found in the selected properties, assets, or uploads.");
        }

        // --- Step B: Create Lead Form with Custom Questions ---
        logToFile("--- 2. CREATING LEAD FORM ---");
        const formName = `AI Form - ${Date.now().toString().slice(-6)}`;
        
        let metaCustomQuestions: any[] = [];
        if (customQuestionsStr && customQuestionsStr !== "[]") {
            try {
                const parsedQuestions = JSON.parse(customQuestionsStr);
                metaCustomQuestions = parsedQuestions.map((q: any) => {
                    const metaQ: any = { 
                        type: 'CUSTOM', 
                        label: q.label.substring(0, 200) 
                    };
                    
                    if (q.type === 'MULTIPLE_CHOICE' && Array.isArray(q.options)) {
                        const validOptions = q.options
                            .filter((o: string) => o.trim() !== '')
                            .map((opt: string) => ({ 
                                value: opt.trim(),
                                key: opt.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50)
                            }));
                            
                        if (validOptions.length > 0) {
                            metaQ.options = validOptions;
                        }
                    }
                    return metaQ;
                });
            } catch (e) {
                logToFile("Failed to parse custom questions", e);
            }
        }

        const finalFollowUpUrl = linkUrl || "https://adrolls.in"; // Fallback to prevent API crash

        const leadFormPayload: any = {
            name: formName,
            follow_up_action_url: finalFollowUpUrl, 
            question_page_custom_headline: `Get Pricing & Details`,
            question_page_custom_text: "Confirm details to view pricing.",
            privacy_policy: { 
                url: (privacyPolicyUrl && !privacyPolicyUrl.includes('localhost')) ? privacyPolicyUrl : "https://adrolls.in/privacy", 
                link_text: "Privacy Policy" 
            },
            questions: [
                { type: "FULL_NAME", key: "full_name" },
                { type: "EMAIL", key: "email" },
                { type: "PHONE", key: "phone_number" },
                ...metaCustomQuestions
            ],
            access_token: facebookToken
        };

        logToFile("--- 2b. LEAD FORM PAYLOAD ---", leadFormPayload);

        const formCreateRes = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json; charset=utf-8' 
            },
            body: JSON.stringify(leadFormPayload)
        });
        
        const formCreateData = await formCreateRes.json();

        if (!formCreateRes.ok) {
            logToFile("❌ Lead Form Creation Failed:", formCreateData);
            const metaErrorMsg = formCreateData.error?.error_user_msg || formCreateData.error?.message || "Unknown Error";
            throw new Error(`Meta Lead Form Error: ${metaErrorMsg}`);
        }
        
        const leadFormId = formCreateData.id;
        logToFile(`✅ Lead Form Created: ${leadFormId}`);

        // --- Step C: Upload Creatives (PROXY UPLOAD) ---
        logToFile("--- 3. UPLOADING ALL CREATIVES ---");
        const metaCreativeHashes: string[] = [];
        const creativeUploadPromises = [];

        if (creativeFiles.length > 0) {
            for (const file of creativeFiles) {
                const uploadFormData = new FormData();
                uploadFormData.append('source', file, file.name); 
                uploadFormData.append('access_token', facebookToken);
                
                creativeUploadPromises.push(
                    fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, { 
                        method: 'POST', body: uploadFormData 
                    }).then(res => res.json())
                );
            }
        } 
        
        if (initialImageUrls.length > 0) {
            // Deduplicate URLs and limit to prevent overload
            const uniqueUrls = Array.from(new Set(initialImageUrls)).slice(0, 5);
            for (const url of uniqueUrls) {
                const imageFetch = await fetch(url);
                if (!imageFetch.ok) continue; 
                
                const imageBlob = await imageFetch.blob();
                const uploadFormData = new FormData();
                uploadFormData.append('source', imageBlob, 'marketing_asset.png');
                uploadFormData.append('access_token', facebookToken);
                
                creativeUploadPromises.push(
                    fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, {
                        method: 'POST', body: uploadFormData
                    }).then(res => res.json())
                );
            }
        }
        
        const uploadResults = await Promise.all(creativeUploadPromises);
        uploadResults.forEach((data, i) => {
            if (data.images) {
                const hash = data.images[Object.keys(data.images)[0]].hash;
                metaCreativeHashes.push(hash);
            }
        });

        if (metaCreativeHashes.length === 0) {
            throw new Error("Creative upload failed. Could not upload any images to Facebook.");
        }
        logToFile(`✅ Uploaded ${metaCreativeHashes.length} creatives to Meta.`);

        // --- Step D: AI Copywriting (Gemini 3 Flash via Kie.ai) ---
        // Prepare Vision Inputs (Multimodal)
        const visionInputs: string[] = [];
        
        // Add public URLs from inventory/assets
        if (inventoryIds.length > 0) {
             const { data: props } = await supabase.from('properties').select('image_url').in('id', inventoryIds);
             props?.forEach(p => { if (p.image_url) visionInputs.push(p.image_url); });
        }
        if (assetIds.length > 0) {
             const { data: asts } = await supabase.from('assets').select('url').in('id', assetIds);
             asts?.forEach(a => { if (a.url) visionInputs.push(a.url); });
        }
        // Add Local files as Base64
        for (const file of creativeFiles) {
             const arr = await file.arrayBuffer();
             visionInputs.push(`data:${file.type};base64,${Buffer.from(arr).toString('base64')}`);
        }

        const businessName = data.business_name || "Our Business";
        const contactInfo = data.contact_number || "";

        const llmPrompt = `
        Act as a Senior Ad Creative Director at a top-tier global agency. Craft exactly ${metaCreativeHashes.length} distinct, highly persuasive ad copy variations—one for each of the ${metaCreativeHashes.length} creatives provided.
        
        Business Context:
        Name: ${businessName}
        Contact: ${contactInfo}
        Mission/Details: ${combinedContext || "Quality services and products."}
        Target Location: "Multiple Selected Locations".
        
        CRITICAL RULES:
        1. STRATEGY: Use professional, high-end agency standards. Focus on elite "Visual DNA" evolution—use the context from the images to write copy that feels like it was born from those visuals.
        2. MANDATORY: YOU MUST ALWAYS INCLUDE THE BUSINESS NAME (${businessName}) AND CONTACT INFORMATION (${contactInfo}) IN EVERY SINGLE VARIATION. If you miss this, the ad will fail.
        3. DO NOT include any website URLs, links, or domain names in the primary text or headline.
        4. NO HASHTAGS (#): Do not use any hashtags in the copy.
        5. MODERATE LENGTH: Keep the primary text moderate (max 400 characters). Avoid long, exhausting paragraphs.
        6. KEYWORDS: At the very end of each primary_text, add 5-6 relevant keywords in brackets, e.g., [Keyword1, Keyword2, Keyword3...]
        7. FORMATTING: Use a clean, structured layout with bullet points, short punchy sentences, and relevant emojis (e.g., ✅, 🚀, 💎). 
        8. SUBJECTS: Ensure the tone is aspirational and premium. If the images contain people, align the copy with their demographic and business context.
        9. OUTPUT FORMAT: Return ONLY a valid JSON array of objects. No conversational text, no markdown code blocks, no bold markers (**), no explanation.
        
        JSON Structure:
        [
          {"primary_text": "Premium agency-grade copy with bullet points, emojis, business name, and phone.", "headline": "Short punchy hook (max 40 chars)"}
        ]
        (Generate exactly ${metaCreativeHashes.length} objects in the array)
        `;
        
        let copyVariations = [
            { primary_text: "Exclusive Property Deal. View pricing & details now.", headline: "View Details" }
        ];

        try {
            logToFile("--- 4a. AI COPYWRITING INPUT ---", { promptLength: llmPrompt.length, visionImages: visionInputs.length });
            logToFile("--- 4b. AI PROMPT ---", llmPrompt);

            const aiRaw = await callGemini(llmPrompt, visionInputs);
            logToFile("--- 4c. AI RAW RESPONSE ---", aiRaw);

            // Robust JSON extraction & cleanup
            const cleanedText = aiRaw
                .replace(/```json\s*/g, '')
                .replace(/\s*```/g, '')
                .replace(/\*\*/g, ''); // Remove bold markers

            const jsonMatch = cleanedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
            const cleanedJson = jsonMatch ? jsonMatch[0] : cleanedText.trim();
            
            const parsed = JSON.parse(cleanedJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
                copyVariations = parsed;
                logToFile(`✅ Generated ${copyVariations.length} AI Copy Variations (Official Gemini Vision).`, copyVariations);
            }
        } catch (e: any) {
            logToFile("AI Generation Failed (Official Gemini), using default copy.", e.message || e);
        }

        // --- Step E: Campaign ---
        logToFile("--- 5. CAMPAIGN ---");
        const campaignNameSuffix = optimizeForConversions ? 'Conversion Optimized' : 'Lead Gen';
        const campaignPayload = {
            name: `AI Leads - Multi-Creative - ${new Date().toISOString().slice(0, 10)} - ${campaignNameSuffix}`,
            objective: 'OUTCOME_LEADS', 
            status: 'PAUSED', 
            buying_type: 'AUCTION',
            daily_budget: Math.round(dailyBudgetINR * 100), // Fixed: Multiplied by 100 as Meta expects budget in Paise/Cents. 500 becomes 50,000 (500 INR).
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            special_ad_categories: [], // Removed HOUSING category constraint
            access_token: facebookToken,
        };

        const campaignRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(campaignPayload),
        });
        
        const campaignData = await campaignRes.json();
        if (!campaignRes.ok) {
            logToFile("❌ Campaign Creation Failed:", campaignData);
            const metaErr = campaignData.error;
            const fullMsg = metaErr?.error_user_msg || metaErr?.message || "Invalid parameter";
            const title = metaErr?.error_user_title ? `${metaErr.error_user_title}: ` : "";
            throw new Error(`Campaign Error: ${title}${fullMsg}`);
        }
        const campaignId = campaignData.id;

        // --- Parse Location Targeting ---
        logToFile("--- PREPARING LOCATION TARGETING ---");
        let targetingConfig: any = { geo_locations: { countries: ['IN'] } }; 
        
        if (metaLocationsStr) {
            try {
                const locationsArray = JSON.parse(metaLocationsStr);
                if (Array.isArray(locationsArray) && locationsArray.length > 0) {
                    targetingConfig = { geo_locations: { cities: [], regions: [], countries: [], zips: [] } };
                    
                    locationsArray.forEach((locData: any) => {
                        const loc = locData.location;
                        if (loc && loc.key) {
                            if (loc.type === 'city') {
                                targetingConfig.geo_locations.cities.push({ key: loc.key, radius: locData.radius || 20, distance_unit: 'kilometer' });
                            } else if (loc.type === 'region') {
                                targetingConfig.geo_locations.regions.push({ key: loc.key });
                            } else if (loc.type === 'country') {
                                targetingConfig.geo_locations.countries.push(loc.country_code || loc.key);
                            } else if (loc.type === 'zip') {
                                targetingConfig.geo_locations.zips.push({ key: loc.key });
                            }
                        }
                    });

                    if (targetingConfig.geo_locations.cities.length === 0) delete targetingConfig.geo_locations.cities;
                    if (targetingConfig.geo_locations.regions.length === 0) delete targetingConfig.geo_locations.regions;
                    if (targetingConfig.geo_locations.countries.length === 0) delete targetingConfig.geo_locations.countries;
                    if (targetingConfig.geo_locations.zips.length === 0) delete targetingConfig.geo_locations.zips;
                }
            } catch (e) {
                console.error("Failed to parse locations array", e);
            }
        }

        // --- Step F: Ad Set ---
        logToFile("--- 6. AD SET ---");
        const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); 

        const adSetPayload: any = {
            name: `Smart AdSet - AI Audiences`,
            campaign_id: campaignId,
            destination_type: 'ON_AD', 
            optimization_goal: optimizeForConversions ? 'QUALITY_LEAD' : 'LEAD_GENERATION', 
            billing_event: 'IMPRESSIONS', 
            targeting: targetingConfig,
            promoted_object: { page_id: pageId },
            start_time: startTime, 
            status: 'PAUSED',
            access_token: facebookToken,
        };

        const adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adSetPayload),
        });
        
        const adSetData = await adSetRes.json();
        if (!adSetRes.ok) {
            logToFile("❌ Ad Set Creation Failed:", adSetData);
            throw new Error(`Ad Set Error: ${adSetData.error?.message}`);
        }
        const adSetId = adSetData.id;

        // --- Step G & H: Loop Creatives & Final Ads ---
        logToFile("--- 7. GENERATING MULTIPLE ADS ---");
        
        let successfulAds = 0;
        let lastDraftError = null;

        // Ensure we create exactly as many ads as selected creatives
        const totalAdsToCreate = metaCreativeHashes.length;
        
        for (let i = 0; i < totalAdsToCreate; i++) {
            // Cycle through unique assets and unique copy
            const hash = metaCreativeHashes[i % metaCreativeHashes.length];
            const copy = copyVariations[i % copyVariations.length];

            // Create Creative
            const creativePayload = {
                name: `Creative ${i + 1} - ${Date.now()}`,
                object_story_spec: {
                    page_id: pageId, 
                    link_data: {
                        message: copy.primary_text || "View our latest property.", 
                        name: copy.headline || "View Details", 
                        link: linkUrl, 
                        image_hash: hash, 
                        call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: leadFormId } }
                    }
                },
                access_token: facebookToken,
            };

            const creativeRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adcreatives`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(creativePayload),
            });
            const creativeData = await creativeRes.json();
            
            if (!creativeRes.ok) {
                logToFile(`❌ Creative ${i+1} Failed:`, creativeData);
                continue; // Skip to next if creative fails
            }

            // Create Ad
            const adPayload = {
                name: `AI Ad Variation ${i + 1}`,
                adset_id: adSetId,
                creative: { creative_id: creativeData.id },
                status: 'PAUSED', 
                access_token: facebookToken,
            };

            const adRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/ads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(adPayload),
            });
            const adData = await adRes.json();

            if (!adRes.ok) {
                logToFile(`❌ Final Ad ${i+1} Failed (Drafted):`, adData);
                if (adData.error?.error_subcode === 1359188 || adData.error?.code === 100) {
                    lastDraftError = true;
                }
            } else {
                successfulAds++;
            }
        }

        if (successfulAds === 0 && lastDraftError) {
             return NextResponse.json({ 
                success: true, 
                campaignId: campaignId, 
                message: "Campaign DRAFTED! \n\n⚠️ Payment Method Missing: Saved in Ads Manager." 
            });
        }

        return NextResponse.json({ 
            success: true, 
            campaignId: campaignId, 
            message: `Campaign Launched Successfully with ${successfulAds} AI Optimized Ads!` 
        });

    } catch (error: any) {
        logToFile("!!! API CRASH !!!", error.message);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" }, 
            { status: 500 }
        );
    }
}