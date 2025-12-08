// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/meta-ads/launch-campaign/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import fs from 'fs'
import path from 'path'

// NOTE: No AI import needed for hardcoded mode
const FB_MARKETING_URL = "https://graph.facebook.com/v19.0"

// Path to the log file
const LOG_FILE_PATH = path.join(process.cwd(), 'meta_ads_debug.txt');

// --- LOGGING HELPER ---
function logToFile(message: string, data?: any) {
    try {
        const timestamp = new Date().toISOString();
        const logEntry = `\n[${timestamp}] ${message}\n${data ? JSON.stringify(data, null, 2) : ''}\n------------------------------------------------\n`;
        
        // Append to the file (we clear it only once at the start of the request)
        fs.appendFileSync(LOG_FILE_PATH, logEntry);
        
        // Also log to console for realtime view
        console.log(message);
        if (data) console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Logging failed:", e);
    }
}

export async function POST(request: Request) {
    // --- 1. RESET LOG FILE FOR NEW RUN ---
    try {
        fs.writeFileSync(LOG_FILE_PATH, ''); // Wipes the file clean
        console.log("Log file cleared for new run.");
    } catch (e) {
        console.error("Failed to clear log file:", e);
    }

    const supabase = await createClient()
    
    // 2. Auth Check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 3. Read Form Data
    const formData = await request.formData();
    
    // Extract Text Fields
    const adAccountId = formData.get('adAccountId')?.toString();
    const facebookToken = formData.get('facebookToken')?.toString();
    const sourceType = formData.get('sourceType')?.toString();
    const targetLocation = formData.get('targetLocation')?.toString(); 
    const dailyBudgetINR = parseFloat(formData.get('dailyBudgetINR')?.toString() || '0');
    const pageId = formData.get('pageId')?.toString();
    const linkUrl = formData.get('linkUrl')?.toString();
    const privacyPolicyUrl = formData.get('privacyPolicyUrl')?.toString();

    // Extract Arrays/Files
    const selectedSourceIds = formData.getAll('selectedSourceIds[]').map(String); 
    const creativeFiles = [];
    for (const [key, value] of formData.entries()) {
        if (key.startsWith('creativeFiles[') && value instanceof Blob) {
            creativeFiles.push(value);
        }
    }

    // Basic Validation
    if (!facebookToken || !adAccountId || !pageId || !linkUrl || !privacyPolicyUrl) {
        return NextResponse.json({ error: 'Missing essential data: Token, Account, Page, Link, or Privacy Policy.' }, { status: 400 });
    }

    logToFile("=== STARTING CAMPAIGN LAUNCH (HARDCODED MODE) ===");
    logToFile(`Account: ${adAccountId} | Page: ${pageId}`);

    try {
        // --- Step A: Get Source Data (Just for logging/context) ---
        let initialImageUrls: string[] = []; 

        if (sourceType === 'inventory' && selectedSourceIds.length > 0) {
            const id = selectedSourceIds[0];
            const { data: prop } = await supabase.from('properties').select('images').eq('id', id).single();
            if (prop) initialImageUrls = prop.images || [];
        } else if (sourceType === 'asset' && selectedSourceIds.length > 0) {
             const id = selectedSourceIds[0];
             const { data: asset } = await supabase.from('assets').select('url').eq('id', id).single();
             if (asset) initialImageUrls = [asset.url];
        }

        // --- STEP B: AUTOMATICALLY CREATE LEAD FORM ---
        logToFile("--- 1. CREATING LEAD FORM ---");
        
        const formName = `Hardcoded Form ${new Date().getTime()}`;
        
        const leadFormPayload = {
            name: formName,
            follow_up_action_url: linkUrl, 
            question_page_custom_headline: "Get Details",
            question_page_custom_text: "Please confirm your info below.",
            privacy_policy: {
                url: privacyPolicyUrl,
                link_text: "Privacy Policy"
            },
            questions: [
                { type: "FULL_NAME", key: "full_name" },
                { type: "EMAIL", key: "email" },
                { type: "PHONE", key: "phone_number" }
            ],
            access_token: facebookToken
        };

        logToFile("Lead Form Payload:", leadFormPayload);

        const formCreateRes = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(leadFormPayload)
        });

        const formDataRes = await formCreateRes.json();

        if (!formCreateRes.ok) {
            logToFile("❌ Lead Form Creation Failed:", formDataRes);
            throw new Error(`Lead Form Error: ${formDataRes.error?.message || formDataRes.error?.error_user_msg} (Code: ${formDataRes.error?.code})`);
        }

        const leadFormId = formDataRes.id;
        logToFile(`✅ Lead Form Created: ${leadFormId}`);


        // --- Step C: Upload Creatives (Images) ---
        logToFile("--- 2. UPLOADING CREATIVE ASSETS ---");
        const metaCreativeHashes: string[] = [];
        const creativeUploadPromises = [];

        // CASE 1: File Upload
        if (creativeFiles.length > 0) {
            for (const file of creativeFiles) {
                const uploadFormData = new FormData();
                uploadFormData.append('source', file, file.name); 
                uploadFormData.append('access_token', facebookToken);
                
                creativeUploadPromises.push(fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, {
                    method: 'POST',
                    body: uploadFormData, 
                }).then(res => res.json()));
            }
        } 
        // CASE 2: URL Upload
        else if (initialImageUrls.length > 0) {
            const url = initialImageUrls[0];
            logToFile(`Uploading URL: ${url}`);
            creativeUploadPromises.push(fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url, access_token: facebookToken }),
            }).then(res => res.json()));
        } else {
            throw new Error("No image files or URLs provided.");
        }
        
        const uploadResults = await Promise.all(creativeUploadPromises);
        
        uploadResults.forEach((data, index) => {
            if (data.images) {
                const hash = data.images[Object.keys(data.images)[0]].hash;
                metaCreativeHashes.push(hash);
                logToFile(`✅ Image ${index + 1} Uploaded. Hash: ${hash}`);
            } else {
                logToFile(`❌ Image ${index + 1} Failed:`, data);
            }
        });

        if (metaCreativeHashes.length === 0) throw new Error("Creative upload failed entirely.");
        const mainCreativeHash = metaCreativeHashes[0]; 


        // --- Step D: Campaign Creation ---
        logToFile("--- 3. CREATING CAMPAIGN ---");

        const campaignPayload = {
            name: `Hardcoded Lead Campaign - ${new Date().toISOString().slice(0, 16)}`,
            objective: 'OUTCOME_LEADS', 
            status: 'PAUSED', 
            buying_type: 'AUCTION',
            daily_budget: dailyBudgetINR, 
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            special_ad_categories: ['HOUSING'],
            special_ad_category_country: ['IN'], 
            access_token: facebookToken,
        };

        logToFile("Campaign Payload:", campaignPayload);

        const campaignRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(campaignPayload),
        });
        const campaignData = await campaignRes.json();

        if (!campaignRes.ok) {
            logToFile("❌ Campaign Failed:", campaignData);
            throw new Error(`Campaign Error: ${campaignData.error?.message}`);
        }
        const campaignId = campaignData.id;
        logToFile(`✅ Campaign Created: ${campaignId}`);


        // --- Step E: Ad Set Creation ---
        logToFile("--- 4. CREATING AD SET ---");

        const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const adSetPayload = {
            name: `Hardcoded AdSet - IN Broad`,
            campaign_id: campaignId,
            destination_type: 'ON_AD', 
            optimization_goal: 'LEAD_GENERATION', 
            billing_event: 'IMPRESSIONS', 
            
            targeting: {
                geo_locations: { 
                    countries: ['IN'] 
                },
            },
            
            promoted_object: {
                page_id: pageId, 
            },
            
            start_time: startTime, 
            status: 'PAUSED',
            access_token: facebookToken,
        };

        logToFile("Ad Set Payload:", adSetPayload);

        const adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adSetPayload),
        });
        const adSetData = await adSetRes.json();

        if (!adSetRes.ok) {
            logToFile("❌ Ad Set Failed:", adSetData);
            throw new Error(`Ad Set Error: ${adSetData.error?.message}`);
        }
        const adSetId = adSetData.id;
        logToFile(`✅ Ad Set Created: ${adSetId}`);


        // --- Step F: Ad Creative Object ---
        logToFile("--- 5. CREATING AD CREATIVE OBJECT ---");

        const primaryText = "This is a test advertisement. Exclusive property deals available now.";
        const headline = "View Property Details";

        const creativePayload = {
            name: `Hardcoded Creative - ${new Date().getTime()}`,
            object_story_spec: {
                page_id: pageId, 
                link_data: {
                    message: primaryText, 
                    name: headline, 
                    link: linkUrl, 
                    image_hash: mainCreativeHash, 
                    call_to_action: { 
                        type: 'SIGN_UP', 
                        value: { 
                            lead_gen_form_id: leadFormId 
                        } 
                    }
                }
            },
            access_token: facebookToken,
        };

        logToFile("Creative Payload:", creativePayload);

        const creativeRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adcreatives`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(creativePayload),
        });
        const creativeData = await creativeRes.json();

        if (!creativeRes.ok) {
            logToFile("❌ Creative Object Failed:", creativeData);
            const userMsg = creativeData.error?.error_user_msg || creativeData.error?.message;
            throw new Error(`Creative Error: ${userMsg}`);
        }
        const creativeId = creativeData.id;
        logToFile(`✅ Creative Object Created: ${creativeId}`);


        // --- Step G: Create Final Ad ---
        logToFile("--- 6. CREATING FINAL AD ---");

        const adPayload = {
            name: `Hardcoded Ad - Final`,
            adset_id: adSetId,
            creative: { creative_id: creativeId },
            status: 'PAUSED', 
            access_token: facebookToken,
        };

        logToFile("Ad Payload:", adPayload);

        const adRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/ads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adPayload),
        });
        const adData = await adRes.json();

        if (!adRes.ok) {
            logToFile("❌ Final Ad Failed (Likely Payment or Policy):", adData);
            
            // SOFT FAILURE FOR PAYMENT ISSUE
            if (adData.error?.error_subcode === 1359188 || adData.error?.code === 100) {
                return NextResponse.json({ 
                    success: true, 
                    campaignId: campaignId, 
                    adSetId: adSetId,
                    message: "Campaign DRAFTED successfully! \n\n⚠️ Action Required: Please add a payment method in Facebook Ads Manager to publish the final ad." 
                });
            }
            
            throw new Error(`Final Ad Error: ${adData.error?.message}`);
        }
        
        logToFile(`✅ Ad Created Successfully: ${adData.id}`);

        return NextResponse.json({ 
            success: true, 
            campaignId: campaignId, 
            adSetId: adSetId,
            adId: adData.id,
            message: "Hardcoded Lead Gen Campaign Launched Successfully" 
        });

    } catch (error: any) {
        logToFile("!!! API CRASH !!!", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}