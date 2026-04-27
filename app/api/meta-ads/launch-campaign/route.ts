import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import fs from 'fs';
import path from 'path';
import { generateKieChat } from '@/utils/external-apis';

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

const LOG_FILE_PATH = path.join(process.cwd(), 'meta_ads_debug.txt');

function logToFile(message: string, data?: any) {
    try {
        const timestamp = new Date().toISOString();
        const dataStr = data ? JSON.stringify(data, null, 2) : '';
        const logEntry = `\n[${timestamp}] ${message}\n${dataStr}\n------------------------------------------------\n`;
        fs.appendFileSync(LOG_FILE_PATH, logEntry);
        console.log(`[META AI] ${message}`, data ? JSON.stringify(data) : '');
    } catch (e) {
        console.error("Logging failed:", e);
    }
}

export async function POST(request: Request) {
    try {
        fs.writeFileSync(LOG_FILE_PATH, '');
    } catch (e) {}

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

    const formData = await request.formData();
    
    const adAccountId = formData.get('adAccountId')?.toString();
    const facebookToken = formData.get('facebookToken')?.toString();
    const targetLocation = formData.get('targetLocation')?.toString() || 'India'; 
    const metaLocationStr = formData.get('metaLocation')?.toString(); 
    const dailyBudgetINR = parseFloat(formData.get('dailyBudgetINR')?.toString() || '0');
    const pageId = formData.get('pageId')?.toString();
    const linkUrl = formData.get('linkUrl')?.toString();
    const privacyPolicyUrl = formData.get('privacyPolicyUrl')?.toString();
    const customQuestionsStr = formData.get('customQuestions')?.toString();

    // NEW: Capture multiple sources from the Creative Cart
    const inventoryIds = formData.getAll('inventoryIds').map(String);
    const assetIds = formData.getAll('assetIds').map(String);
    
    const creativeFiles = [];
    for (const [key, value] of formData.entries()) {
        if (key.startsWith('creativeFiles[') && value instanceof Blob) {
            creativeFiles.push(value);
        }
    }

    if (!facebookToken || !adAccountId || !pageId || !linkUrl || !privacyPolicyUrl) {
        return NextResponse.json(
            { error: 'Missing essential data: Token, Account, Page, Link, or Privacy Policy.' }, 
            { status: 400 }
        );
    }

    logToFile("=== STARTING AI CAMPAIGN LAUNCH (MULTI-CREATIVE) ===");

    try {
        // --- Step A: Get Source Data & Context ---
        logToFile("--- 1. FETCHING SOURCE DATA ---");
        let combinedContext = "";
        let initialImageUrls: string[] = []; 

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

        const leadFormPayload = {
            name: formName,
            follow_up_action_url: linkUrl, 
            question_page_custom_headline: `Get Pricing & Details`,
            question_page_custom_text: "Confirm details to view pricing.",
            privacy_policy: { 
                url: privacyPolicyUrl, 
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

        const formCreateRes = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json; charset=utf-8' 
            },
            body: JSON.stringify(leadFormPayload)
        });
        
        const formDataRes = await formCreateRes.json();

        if (!formCreateRes.ok) {
            logToFile("❌ Lead Form Failed Payload:", leadFormPayload);
            logToFile("❌ Lead Form Failed Response:", formDataRes);
            const metaErrorMsg = formDataRes.error?.error_user_msg || formDataRes.error?.message || "Unknown Error";
            throw new Error(`Meta Lead Form Error: ${metaErrorMsg}`);
        }
        
        const leadFormId = formDataRes.id;
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
        logToFile("--- 4. AI COPYWRITING (MULTIPLE VARIATIONS) ---");
        const numberOfAds = Math.max(metaCreativeHashes.length, 3);
        const llmPrompt = `
        Act as an elite direct-response real estate marketer. Craft exactly ${numberOfAds} distinct, highly persuasive ad copy variations.
        
        Context provided by the user:
        ${combinedContext || "Luxury properties."}
        Target Location: "${targetLocation}".
        
        CRITICAL RULES:
        1. Apply Alex Hormozi's marketing frameworks: Emphasize "Value Stacking", create "Grand Slam Offers", use risk reversal, and write strong, emotionally resonant hooks.
        2. DO NOT use the term "2 BHK". If a unit type is mentioned, always use "2 RK".
        
        Output MUST be valid JSON array of objects, exactly like this:
        [
          {"primary_text": "Engaging direct response copy highlighting the offer and value (max 125 chars).", "headline": "Short punchy hook (max 25 chars)"},
          ...
        ]
        `;
        
        let copyVariations = [
            { primary_text: "Exclusive Property Deal. View pricing & details now.", headline: "View Details" }
        ];

        try {
            const aiRaw = await generateKieChat(llmPrompt, "gemini-3-flash");
            const cleanedJson = aiRaw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            const parsed = JSON.parse(cleanedJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
                copyVariations = parsed;
                logToFile(`✅ Generated ${copyVariations.length} AI Copy Variations.`);
            }
        } catch (e) {
            logToFile("AI Generation Failed, using default copy.", e);
        }

        // --- Step E: Campaign ---
        logToFile("--- 5. CAMPAIGN ---");
        const campaignPayload = {
            name: `AI Leads - Multi-Creative - ${new Date().toISOString().slice(0, 10)}`,
            objective: 'OUTCOME_LEADS', 
            status: 'PAUSED', 
            buying_type: 'AUCTION',
            daily_budget: dailyBudgetINR, 
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            special_ad_categories: ['HOUSING'],
            special_ad_category_country: ['IN'], 
            access_token: facebookToken,
        };

        const campaignRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(campaignPayload),
        });
        
        const campaignData = await campaignRes.json();
        if (!campaignRes.ok) throw new Error(`Campaign Error: ${campaignData.error?.message}`);
        const campaignId = campaignData.id;

        // --- Parse Location Targeting ---
        logToFile("--- PREPARING LOCATION TARGETING ---");
        let targetingConfig = { geo_locations: { countries: ['IN'] } }; 
        
        if (metaLocationStr) {
            try {
                const locData = JSON.parse(metaLocationStr);
                const loc = locData.location;
                if (loc && loc.key) {
                    if (loc.type === 'city') {
                        targetingConfig = { geo_locations: { cities: [{ key: loc.key, radius: locData.radius || 20, distance_unit: 'kilometer' }] } } as any;
                    } else if (loc.type === 'region') {
                        targetingConfig = { geo_locations: { regions: [{ key: loc.key }] } } as any;
                    } else if (loc.type === 'country') {
                        targetingConfig = { geo_locations: { countries: [loc.country_code || loc.key] } } as any;
                    } else if (loc.type === 'zip') {
                        targetingConfig = { geo_locations: { zips: [{ key: loc.key }] } } as any;
                    }
                }
            } catch (e) {}
        }

        // --- Step F: Ad Set ---
        logToFile("--- 6. AD SET ---");
        const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); 

        const adSetPayload = {
            name: `Smart AdSet - ${targetLocation}`,
            campaign_id: campaignId,
            destination_type: 'ON_AD', 
            optimization_goal: 'LEAD_GENERATION', 
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
        if (!adSetRes.ok) throw new Error(`Ad Set Error: ${adSetData.error?.message}`);
        const adSetId = adSetData.id;

        // --- Step G & H: Loop Creatives & Final Ads ---
        logToFile("--- 7. GENERATING MULTIPLE ADS ---");
        
        let successfulAds = 0;
        let lastDraftError = null;

        for (let i = 0; i < metaCreativeHashes.length; i++) {
            const hash = metaCreativeHashes[i];
            const copy = copyVariations[i % copyVariations.length]; // cycle if fewer copies than images

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