import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { callGemini } from '@/utils/external-apis'; 

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0"

export async function POST(request: Request) {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 1. Read Form Data (Handling files and text inputs)
    const formData = await request.formData();
    
    // Extract fields
    const adAccountId = formData.get('adAccountId')?.toString();
    const facebookToken = formData.get('facebookToken')?.toString();
    const sourceType = formData.get('sourceType')?.toString();
    const targetLocation = formData.get('targetLocation')?.toString();
    const gender = formData.get('gender')?.toString();
    const dailyBudgetINR = parseFloat(formData.get('dailyBudgetINR')?.toString() || '0');
    const pageId = formData.get('pageId')?.toString();
    const linkUrl = formData.get('linkUrl')?.toString();

    // Get array of selected IDs (non-file source)
    const selectedSourceIds = formData.getAll('selectedSourceIds[]').map(String); 
    
    // Get array of uploaded files by iterating through FormData keys
    const creativeFiles = [];
    for (const [key, value] of formData.entries()) {
        if (key.startsWith('creativeFiles[') && value instanceof Blob) {
            creativeFiles.push(value);
        }
    }

    if (!facebookToken || !adAccountId || !pageId || !linkUrl) {
        return NextResponse.json({ error: 'Missing essential campaign data (Account, Page, or Link URL).' }, { status: 400 });
    }

    try {
        // --- Step A: Get Source Data (Title/Description for LLM) ---
        let propertyTitle: string = '';
        let propertyDescription: string = '';
        let initialImageUrls: string[] = []; 

        if (sourceType === 'inventory' && selectedSourceIds.length > 0) {
            const id = selectedSourceIds[0];
            const { data: prop } = await supabase.from('properties').select('title, description, images').eq('id', id).single();
            if (prop) {
                propertyTitle = prop.title || '';
                propertyDescription = prop.description || '';
                initialImageUrls = prop.images || [];
            }
        } else if (sourceType === 'asset' && selectedSourceIds.length > 0) {
             const id = selectedSourceIds[0];
             const { data: asset } = await supabase.from('assets').select('url').eq('id', id).single();
             if (asset) initialImageUrls = [asset.url];
        }

        // --- Step B: Upload Creatives to Meta ---
        const metaCreativeHashes: string[] = [];
        const creativeUploadPromises = [];

        // 2.1 Handle uploaded files first (Direct File Upload)
        if (creativeFiles.length > 0) {
            for (const file of creativeFiles) {
                const uploadFormData = new FormData();
                
                uploadFormData.append('source', file, file.name); 
                uploadFormData.append('access_token', facebookToken);
                
                creativeUploadPromises.push(fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, {
                    method: 'POST',
                    body: uploadFormData, 
                }).then(res => res.json()).then(data => {
                    if (data.images) {
                        const imageHash = Object.keys(data.images)[0];
                        return data.images[imageHash].hash;
                    }
                    throw new Error(data.error?.message || "File upload failed.");
                }));
            }
        }
        
        // 2.2 Handle assets from URL (if files were NOT uploaded, and URLs exist)
        if (creativeFiles.length === 0 && initialImageUrls.length > 0) {
            for (const url of initialImageUrls.slice(0, 3)) { 
                creativeUploadPromises.push(fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url, access_token: facebookToken }),
                }).then(res => res.json()).then(data => {
                    if (data.images) {
                        const imageHash = Object.keys(data.images)[0];
                        return data.images[imageHash].hash;
                    }
                    throw new Error(data.error?.message || "URL upload failed.");
                }));
            }
        }
        
        const hashes = await Promise.allSettled(creativeUploadPromises);
        metaCreativeHashes.push(...hashes
            .filter(result => result.status === 'fulfilled' && result.value)
            .map(result => (result as PromiseFulfilledResult<string>).value)
        );

        if (metaCreativeHashes.length === 0) {
            throw new Error("No usable creative assets could be uploaded to Meta.");
        }
        
        const mainCreativeHash = metaCreativeHashes[0];


        // --- Step C: AI Copy Generation (LLM Call) ---
        const llmPrompt = `Generate 5 unique Primary Text variations (max 125 chars each) and 5 unique Headline variations (max 40 chars each) for a real estate ad. The tone should be urgent and high-value. The ad is for: "${propertyTitle || 'Asset ID: ' + selectedSourceIds[0]}". Use this detail: "${propertyDescription}". The target location is ${targetLocation}. Return only a single JSON object with two arrays: 'primary_texts' and 'headlines'. The JSON MUST NOT contain any markdown formatting, backticks, or explanatory text outside of the arrays.`;
        
        let primaryTexts: string[] = ["New listing in the area!"];
        let headlines: string[] = ["Don't miss out!"];

        try {
            const llmResponseText = await callGemini(llmPrompt); 
            
            let cleanedJsonText = llmResponseText.trim();
            if (cleanedJsonText.startsWith('```json')) {
                cleanedJsonText = cleanedJsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            }

            const llmCreative = JSON.parse(cleanedJsonText);
            primaryTexts = llmCreative.primary_texts?.slice(0, 5) || primaryTexts;
            headlines = llmCreative.headlines?.slice(0, 5) || headlines;
        } catch (e) {
            console.warn("LLM Creative generation failed, using defaults.", e);
        }

        // --- Step D: Create CBO Campaign Structure ---
        
        // 4.1 Create Campaign 
        const campaignRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: `AI CBO - ${propertyTitle || 'Campaign'} - ${new Date().toISOString().slice(0, 10)}`,
                objective: 'OUTCOME_LEADS', 
                status: 'PAUSED', 
                buying_type: 'AUCTION',
                daily_budget: dailyBudgetINR, 
                
                // CRITICAL FIX: Required Special Ad Category for Housing
                special_ad_categories: ['HOUSING'], 
                
                access_token: facebookToken,
            }),
        });
        const campaignData = await campaignRes.json();
        if (!campaignRes.ok) throw new Error("Campaign creation failed: " + campaignData.error?.message);
        const campaignId = campaignData.id;


        // 4.2 Create Ad Set (Targeting)
        
        const adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: `AI AdSet - ${targetLocation} (Broad)`,
                campaign_id: campaignId,
                billing_event: 'IMPRESSIONS',
                optimization_goal: 'LEAD_GENERATION',
                bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
                
                // FINAL COMPLIANCE FIX: Minimal Ad Set payload required for Housing Compliance
                targeting: {
                    geo_locations: { 
                        countries: ['IN'] 
                    }
                },
                
                // NEW FIXES: Add required structural fields that might be implicitly checked:
                promoted_object: {
                    page_id: pageId, // Promoted object is usually required for objective tie-in
                },
                publisher_platforms: ['facebook', 'instagram'], // Explicitly define platforms
                start_time: new Date().toISOString(), // FIX: Ensure start time is explicit

                status: 'PAUSED',
                access_token: facebookToken,
            }),
        });
        const adSetData = await adSetRes.json();
        if (!adSetRes.ok) throw new Error("AdSet creation failed: " + adSetData.error?.message);
        const adSetId = adSetData.id;


        // 4.3 Create Multiple Ads (N x M Ad Variations)
        const adCreationPromises = [];

        for (let i = 0; i < primaryTexts.length; i++) {
            for (let j = 0; j < headlines.length; j++) {
                
                // Create Ad Creative (for each copy variation)
                 const creativeRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adcreatives`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: `AI Creative ${i+1}-${j+1}`,
                        object_story_spec: {
                            page_id: pageId, 
                            link_data: {
                                message: primaryTexts[i], 
                                headline: headlines[j], 
                                link: linkUrl, 
                                image_hash: mainCreativeHash, 
                                call_to_action: { type: 'LEARN_MORE', value: { link: linkUrl } }
                            }
                        },
                        access_token: facebookToken,
                    }),
                });
                const creativeData = await creativeRes.json();
                if (!creativeRes.ok) continue; 
                const creativeId = creativeData.id;


                // Create the Ad
                adCreationPromises.push(fetch(`${FB_MARKETING_URL}/${adAccountId}/ads`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: `Ad ${i+1}-${j+1}`,
                        adset_id: adSetId,
                        creative: { creative_id: creativeId },
                        status: 'ACTIVE', 
                        access_token: facebookToken,
                    }),
                }));
            }
        }
        
        await Promise.all(adCreationPromises);

        // 4.4 Activate the Campaign and Ad Set (Last Step)
        
        // Activate Ad Set first
        await fetch(`${FB_MARKETING_URL}/${adSetId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'ACTIVE', access_token: facebookToken }),
        });

        // Activate Campaign
        await fetch(`${FB_MARKETING_URL}/${campaignId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'ACTIVE', access_token: facebookToken }),
        });


        return NextResponse.json({ 
            success: true, 
            campaignId,
            message: "CBO Campaign successfully launched and activated."
        });

    } catch (error: any) {
        console.error("Meta Ads API CRASH:", error.message);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}