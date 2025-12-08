import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import fs from 'fs'
import path from 'path'
import { callGemini } from '@/utils/external-apis' 

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0"

// Path to the log file for debugging
const LOG_FILE_PATH = path.join(process.cwd(), 'meta_ads_debug.txt');

// --- LOGGING HELPER ---
function logToFile(message: string, data?: any) {
    try {
        const timestamp = new Date().toISOString();
        const logEntry = `\n[${timestamp}] ${message}\n${data ? JSON.stringify(data, null, 2) : ''}\n------------------------------------------------\n`;
        fs.appendFileSync(LOG_FILE_PATH, logEntry);
        console.log(message); 
    } catch (e) {
        console.error("Logging failed:", e);
    }
}

export async function POST(request: Request) {
    // 1. Reset Log File for new run
    try { fs.writeFileSync(LOG_FILE_PATH, ''); } catch (e) {}

    const supabase = await createClient()
    
    // 2. Auth Check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 3. Read Form Data
    const formData = await request.formData();
    
    const adAccountId = formData.get('adAccountId')?.toString();
    const facebookToken = formData.get('facebookToken')?.toString();
    const sourceType = formData.get('sourceType')?.toString();
    const targetLocation = formData.get('targetLocation')?.toString(); 
    const dailyBudgetINR = parseFloat(formData.get('dailyBudgetINR')?.toString() || '0');
    const pageId = formData.get('pageId')?.toString();
    const linkUrl = formData.get('linkUrl')?.toString();
    const privacyPolicyUrl = formData.get('privacyPolicyUrl')?.toString();

    // FIX: Removed the '[]' to match the Frontend
    const selectedSourceIds = formData.getAll('selectedSourceIds').map(String); 
    
    const creativeFiles = [];
    for (const [key, value] of formData.entries()) {
        if (key.startsWith('creativeFiles[') && value instanceof Blob) {
            creativeFiles.push(value);
        }
    }

    if (!facebookToken || !adAccountId || !pageId || !linkUrl || !privacyPolicyUrl) {
        return NextResponse.json({ error: 'Missing essential data: Token, Account, Page, Link, or Privacy Policy.' }, { status: 400 });
    }

    logToFile("=== STARTING AI CAMPAIGN LAUNCH ===");
    logToFile(`Source Type: ${sourceType} | Account: ${adAccountId}`);
    logToFile(`Selected IDs:`, selectedSourceIds);

    try {
        // --- Step A: Get Source Data (Title/Description/Images) ---
        let propertyTitle: string = '';
        let propertyDescription: string = '';
        let initialImageUrls: string[] = []; 

        if (sourceType === 'inventory' && selectedSourceIds.length > 0) {
            const id = selectedSourceIds[0];
            
            // Select BOTH 'images' (array) and 'image_url' (single string)
            const { data: prop, error } = await supabase.from('properties')
                .select('title, description, images, image_url')
                .eq('id', id)
                .single();
            
            if (error) {
                logToFile("❌ Database Error:", error);
                throw new Error("Failed to fetch property details.");
            }

            if (prop) {
                propertyTitle = prop.title || '';
                propertyDescription = prop.description || '';
                
                // ROBUST IMAGE CHECK:
                if (prop.images && Array.isArray(prop.images) && prop.images.length > 0) {
                    initialImageUrls = prop.images;
                    logToFile(`✅ Found ${prop.images.length} images in array.`);
                } 
                else if (prop.image_url) {
                    initialImageUrls = [prop.image_url];
                    logToFile(`✅ Found single image URL.`);
                }
            }
        } else if (sourceType === 'asset' && selectedSourceIds.length > 0) {
             const id = selectedSourceIds[0];
             const { data: asset } = await supabase.from('assets').select('url').eq('id', id).single();
             if (asset && asset.url) {
                 initialImageUrls = [asset.url];
                 logToFile(`✅ Found Asset URL.`);
             }
        }

        // Validate we found images before proceeding
        if (creativeFiles.length === 0 && initialImageUrls.length === 0) {
            const msg = "No images found in the selected property or asset. Please check your inventory.";
            logToFile(`❌ ${msg}`);
            throw new Error(msg);
        }

        // --- Step B: Create Lead Form ---
        logToFile("--- 1. CREATING LEAD FORM ---");
        const formName = `AI Form - ${propertyTitle.substring(0, 10)} - ${Date.now().toString().slice(-6)}`;
        
        const leadFormPayload = {
            name: formName,
            follow_up_action_url: linkUrl, 
            question_page_custom_headline: `Details for ${propertyTitle.substring(0,30) || 'this property'}`,
            question_page_custom_text: "Confirm details to view pricing.",
            privacy_policy: { url: privacyPolicyUrl, link_text: "Privacy Policy" },
            questions: [
                { type: "FULL_NAME", key: "full_name" },
                { type: "EMAIL", key: "email" },
                { type: "PHONE", key: "phone_number" }
            ],
            access_token: facebookToken
        };

        const formCreateRes = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(leadFormPayload)
        });
        const formDataRes = await formCreateRes.json();

        if (!formCreateRes.ok) {
            logToFile("❌ Lead Form Failed:", formDataRes);
            throw new Error(`Lead Form Error: ${formDataRes.error?.message} (Code: ${formDataRes.error?.code})`);
        }
        const leadFormId = formDataRes.id;
        logToFile(`✅ Lead Form Created: ${leadFormId}`);


        // --- Step C: Upload Creatives (PROXY UPLOAD) ---
        logToFile("--- 2. UPLOADING CREATIVES ---");
        const metaCreativeHashes: string[] = [];
        const creativeUploadPromises = [];

        // 1. Local Files (Direct Upload)
        if (creativeFiles.length > 0) {
            logToFile(`Uploading ${creativeFiles.length} local file(s)...`);
            for (const file of creativeFiles) {
                const uploadFormData = new FormData();
                uploadFormData.append('source', file, file.name); 
                uploadFormData.append('access_token', facebookToken);
                creativeUploadPromises.push(fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, { method: 'POST', body: uploadFormData }).then(res => res.json()));
            }
        } 
        // 2. Database URLs (PROXY DOWNLOAD & UPLOAD)
        else if (initialImageUrls.length > 0) {
            logToFile(`Processing ${initialImageUrls.length} URL(s)...`);
            
            for (const url of initialImageUrls.slice(0, 3)) {
                logToFile(`Fetching & Uploading: ${url}`);
                
                // A. Download Image to Server Memory
                const imageFetch = await fetch(url);
                if (!imageFetch.ok) {
                    logToFile(`❌ Failed to download image from source: ${url}`);
                    continue; 
                }
                const imageBlob = await imageFetch.blob();

                // B. Upload Binary to Facebook
                const uploadFormData = new FormData();
                uploadFormData.append('source', imageBlob, 'property_image.png');
                uploadFormData.append('access_token', facebookToken);
                
                creativeUploadPromises.push(
                    fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, {
                        method: 'POST',
                        body: uploadFormData
                    }).then(res => res.json())
                );
            }
        }
        
        const uploadResults = await Promise.all(creativeUploadPromises);
        
        uploadResults.forEach((data, i) => {
            if (data.images) {
                const hash = data.images[Object.keys(data.images)[0]].hash;
                metaCreativeHashes.push(hash);
                logToFile(`✅ Image ${i+1} Uploaded: ${hash}`);
            } else {
                logToFile(`❌ Image ${i+1} Failed:`, data);
            }
        });

        if (metaCreativeHashes.length === 0) throw new Error("Creative upload failed. Could not upload any images to Facebook.");
        const mainCreativeHash = metaCreativeHashes[0]; 


        // --- Step D: AI Copy ---
        logToFile("--- 3. AI COPYWRITING ---");
        const llmPrompt = `Write 1 catchy Primary Text (max 125 chars) and 1 Headline (max 25 chars) for a real estate Lead Ad. Property: "${propertyTitle}". Description: "${propertyDescription}". Location: "${targetLocation}". Return JSON: {"primary_text": "...", "headline": "..."}`;
        let primaryText = "Exclusive Property Deal";
        let headline = "View Details";

        try {
            const llmResponse = await callGemini(llmPrompt);
            const cleanedJson = llmResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            const parsed = JSON.parse(cleanedJson);
            if(parsed.primary_text) primaryText = parsed.primary_text;
            if(parsed.headline) headline = parsed.headline;
            logToFile("AI Copy:", parsed);
        } catch (e) {
            logToFile("AI Generation Failed (using defaults).");
        }


        // --- Step E: Campaign ---
        logToFile("--- 4. CAMPAIGN ---");
        const campaignPayload = {
            name: `AI Leads - ${propertyTitle.substring(0, 15)} - ${new Date().toISOString().slice(0, 10)}`,
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
        logToFile(`✅ Campaign ID: ${campaignId}`);


        // --- Step F: Ad Set ---
        logToFile("--- 5. AD SET ---");
        const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); 

        const adSetPayload = {
            name: `AdSet - ${targetLocation}`,
            campaign_id: campaignId,
            destination_type: 'ON_AD', 
            optimization_goal: 'LEAD_GENERATION', 
            billing_event: 'IMPRESSIONS', 
            targeting: { geo_locations: { countries: ['IN'] } }, 
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
        logToFile(`✅ Ad Set ID: ${adSetId}`);


        // --- Step G: Creative ---
        logToFile("--- 6. CREATIVE ---");
        const creativePayload = {
            name: `Creative - ${Date.now()}`,
            object_story_spec: {
                page_id: pageId, 
                link_data: {
                    message: primaryText, 
                    name: headline, 
                    link: linkUrl, 
                    image_hash: mainCreativeHash, 
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
        if (!creativeRes.ok) throw new Error(`Creative Error: ${creativeData.error?.message}`);
        const creativeId = creativeData.id;
        logToFile(`✅ Creative ID: ${creativeId}`);


        // --- Step H: Final Ad (Soft Fail) ---
        logToFile("--- 7. FINAL AD ---");
        const adPayload = {
            name: `Ad - ${headline}`,
            adset_id: adSetId,
            creative: { creative_id: creativeId },
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
            logToFile("❌ Final Ad Failed (Drafted):", adData);
            
            if (adData.error?.error_subcode === 1359188 || adData.error?.code === 100) {
                return NextResponse.json({ 
                    success: true, 
                    campaignId: campaignId, 
                    message: "Campaign DRAFTED! \n\n⚠️ Payment Method Missing: Saved in Ads Manager." 
                });
            }
            throw new Error(`Final Ad Error: ${adData.error?.message}`);
        }
        
        logToFile(`✅ Ad Created: ${adData.id}`);

        return NextResponse.json({ 
            success: true, 
            campaignId: campaignId, 
            message: "Campaign Successfully Launched!" 
        });

    } catch (error: any) {
        logToFile("!!! API CRASH !!!", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}