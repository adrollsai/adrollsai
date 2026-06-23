import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { callGemini } from '@/utils/external-apis';
import { checkLimitAndIncrement, refundLimit } from '@/utils/subscription-server';

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

    // --- 0. Resolve Target User ID ---
    const url = new URL(request.url);
    const impersonateId = url.searchParams.get('impersonate');
    const { data: ownProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
    let targetUserId = user.id;

    if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
        targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
    }

    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
        if (ownProfile?.role !== 'super_admin') {
            const isParent = (ownProfile?.agency_id === impersonateId || ownProfile?.parent_id === impersonateId);
            const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', ownProfile?.agency_id || user.id).single();

            if (isParent || subAccount) {
                targetUserId = impersonateId;
            } else {
                return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
            }
        } else {
            targetUserId = impersonateId;
        }
    }

    // --- SUBSCRIPTION CHECK (Always deduct from the authenticated user, i.e., the agency) ---
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
        data.dailyBudget = parseFloat(formData.get('dailyBudgetINR')?.toString() || formData.get('dailyBudget')?.toString() || '500');
        data.pageId = formData.get('pageId')?.toString();
        data.linkUrl = formData.get('linkUrl')?.toString();
        data.privacyPolicyUrl = formData.get('privacyPolicyUrl')?.toString();
        data.optimizeForConversions = formData.get('optimizeForConversions') === 'true';
        data.customQuestions = formData.get('customQuestions')?.toString();
        data.inventoryIds = formData.getAll('inventoryIds').map(String);
        data.assetIds = formData.getAll('assetIds').map(String);
        data.campaignType = formData.get('campaignType')?.toString();
        data.pixelId = formData.get('pixelId')?.toString();
        
        const ageMinVal = formData.get('ageMin');
        if (ageMinVal) data.ageMin = parseInt(ageMinVal.toString());
        const ageMaxVal = formData.get('ageMax');
        if (ageMaxVal) data.ageMax = parseInt(ageMaxVal.toString());

        const audStr = formData.get('customAudienceIds')?.toString();
        if (audStr) {
            try {
                data.customAudienceIds = JSON.parse(audStr);
            } catch (e) {
                console.error("Failed to parse customAudienceIds from form data", e);
            }
        }

        data.creativeFiles = [];
        formData.forEach((value, key) => {
            if (key.startsWith('creativeFiles[') && value instanceof Blob) {
                data.creativeFiles.push(value);
            }
        });
    }

    // Fetch TARGET profile for credentials and business info (using Admin client to bypass RLS)
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: targetProfile } = await supabaseAdmin.from('profiles')
        .select('facebook_token, ad_account_id, selected_page_id, custom_domain, business_name, contact_number, currency, pixel_id, logo_url')
        .eq('id', targetUserId)
        .single();

    // Diagnostics Logging
    if (!process.env.VERCEL) {
        try {
            const fs = require('fs');
            const path = require('path');
            const logPath = path.join(process.cwd(), 'scratch', 'launch_debug.log');
            fs.appendFileSync(logPath, 
                `[Launch API] Date: ${new Date().toISOString()}\n` +
                `URL: ${request.url}\n` +
                `impersonateId (from query): ${impersonateId}\n` +
                `targetUserId (resolved): ${targetUserId}\n` +
                `user.id (logged-in): ${user.id}\n` +
                `targetProfile exists: ${!!targetProfile}\n` +
                `targetProfile: ${JSON.stringify(targetProfile)}\n` +
                `------------------------------------------------\n`
            );
        } catch (logErr) {
            console.error("Failed to write to launch_debug.log:", logErr);
        }
    }

    let qualifiedLeadsCount = 0;
    try {
        const { count } = await supabaseAdmin
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', targetUserId)
            .eq('pipeline_stage', 'Qualified');
        qualifiedLeadsCount = count || 0;
        logToFile(`Checked CRM Qualified Leads count: ${qualifiedLeadsCount}`);
    } catch (crmErr: any) {
        logToFile("Failed to count CRM qualified leads, defaulting to 0:", crmErr.message);
    }

    if (targetProfile) {
        data.facebookToken = data.facebookToken || targetProfile.facebook_token;
        data.adAccountId = data.adAccountId || targetProfile.ad_account_id;
        data.pageId = data.pageId || targetProfile.selected_page_id;
        
        const targetBusinessUrl = targetProfile.custom_domain 
            ? `https://${targetProfile.custom_domain}` 
            : `https://app.adrolls.in/shared/${targetUserId}`;

        data.linkUrl = data.linkUrl || targetBusinessUrl;
        data.privacyPolicyUrl = data.privacyPolicyUrl || `${targetBusinessUrl}/privacy`;
        data.business_name = targetProfile.business_name;
        data.contact_number = targetProfile.contact_number;
    }

    const {
        facebookToken,
        adAccountId,
        pageId,
        linkUrl,
        privacyPolicyUrl,
        dailyBudget = 500,
        metaLocations: metaLocationsStr,
        optimizeForConversions,
        customQuestions: customQuestionsStr,
        inventoryIds = [],
        assetIds = [],
        creativeFiles = [],
        campaignType = 'instant_form',
        pixelId,
        ageMin,
        ageMax,
        customAudienceIds = []
    } = data;
    
    const currency = targetProfile?.currency || 'INR';

    const finalPixelId = pixelId || targetProfile?.pixel_id || null;
    const isWebsiteCampaign = campaignType === 'website_conversion';

    if (isWebsiteCampaign && !finalPixelId) {
        if (user?.id) {
            await refundLimit(user.id, 'campaign_launches');
        }
        return NextResponse.json(
            { error: 'Meta Pixel ID is required for Website Conversion campaigns. Please select a Pixel or connect one in your profile.' }, 
            { status: 400 }
        );
    }

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

    // --- PRE-FLIGHT: CHECK AD ACCOUNT STATUS ---
    try {
        logToFile("--- 0. CHECKING AD ACCOUNT STATUS ---");
        const accCheckRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}?fields=account_status,disable_reason,balance,currency`, {
            headers: { 'Authorization': `Bearer ${facebookToken}` }
        });
        const accStatus = await accCheckRes.json();
        
        if (accStatus.error) {
            logToFile("Ad Account Check Failed:", accStatus.error);
        } else {
            logToFile("Ad Account Status:", accStatus);
            // account_status 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED, 7 = PENDING_RISK_REVIEW, 8 = PENDING_SETTLEMENT
            if (accStatus.account_status !== 1) {
                const reasons: Record<number, string> = {
                    2: "DISABLED (Check Meta Ads Manager for policy violations)",
                    3: "UNSETTLED (There is an outstanding balance to be paid)",
                    7: "PENDING_RISK_REVIEW (Meta is reviewing your account security)",
                    8: "PENDING_SETTLEMENT (Waiting for last payment to clear)",
                    101: "PENDING_CLOSURE",
                    102: "CLOSED"
                };
                const reasonStr = reasons[accStatus.account_status as number] || `Status Code: ${accStatus.account_status}`;
                logToFile(`⚠️ Ad Account is not Active: ${reasonStr}`);
                
                if (accStatus.account_status === 3) {
                    logToFile("💡 Suggestion: Pay the outstanding balance in Meta Ads Manager.");
                }
            }
        }
    } catch (e) {
        logToFile("Ad Account Pre-flight Error:", e);
    }
    try {
        // --- Step A: Get Source Data & Context ---
        let combinedContext = "";
        interface CreativeItem {
            type: 'image' | 'video';
            file?: Blob;
            url?: string;
        }
        const creativeItems: CreativeItem[] = [];

        if (creativeFiles.length > 0) {
            for (const file of creativeFiles) {
                const isVideo = file.type?.startsWith('video/') || file.name?.toLowerCase().match(/\.(mp4|mov|avi|wmv)$/);
                creativeItems.push({
                    type: isVideo ? 'video' : 'image',
                    file
                });
            }
        }

        if (data.imageUrl) {
            const isVideo = data.imageUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)$/);
            creativeItems.push({
                type: isVideo ? 'video' : 'image',
                url: data.imageUrl
            });
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
                        prop.images.forEach(img => {
                            if (img && img.startsWith('http')) {
                                creativeItems.push({ type: 'image', url: img });
                            }
                        });
                    } else if (prop.image_url) {
                        creativeItems.push({ type: 'image', url: prop.image_url });
                    }
                });
            }
        } 
        
        if (assetIds.length > 0) {
             const { data: assets } = await supabaseAdmin
                .from('assets')
                .select('url, type')
                .in('id', assetIds);
 
             if (assets) {
                 assets.forEach(asset => {
                     if (asset.url) {
                         const isVideo = asset.type === 'video' || asset.url.toLowerCase().match(/\.(mp4|mov|avi|wmv)$/);
                         creativeItems.push({
                             type: isVideo ? 'video' : 'image',
                             url: asset.url
                         });
                     }
                 });
             }
        }

        if (creativeItems.length === 0) {
            throw new Error("No images or videos found in the selected properties, assets, or uploads.");
        }

        // --- Step B: Create Lead Form with Custom Questions ---
        const businessName = data.business_name || "Our Business";
        let leadFormId = null;

        if (!isWebsiteCampaign) {
            logToFile("--- 2. CREATING LEAD FORM ---");
            
            let metaCustomQuestions: any[] = [];
            if (customQuestionsStr && customQuestionsStr !== "[]") {
                try {
                    const parsedQuestions = JSON.parse(customQuestionsStr);
                    metaCustomQuestions = parsedQuestions.map((q: any) => {
                        const label = q.label.trim();
                        const lowerLabel = label.toLowerCase();
                        
                        // NEW: Smart mapping to avoid SAQ (Short Answer Question) PII violations
                        // Meta forbids custom short-answer questions for PII (like Company Name, City, etc.)
                        // We map these to official pre-fill types if they look like standard info.
                        
                        if (q.type !== 'MULTIPLE_CHOICE') {
                            if (lowerLabel.includes('company') || lowerLabel.includes('business name')) {
                                return { type: 'COMPANY_NAME', key: 'company_name' };
                            }
                            if (lowerLabel.includes('job title') || lowerLabel.includes('designation')) {
                                return { type: 'JOB_TITLE', key: 'job_title' };
                            }
                            if (lowerLabel.includes('city')) {
                                return { type: 'CITY', key: 'city' };
                            }
                            if (lowerLabel.includes('state')) {
                                return { type: 'STATE', key: 'state' };
                            }
                        }

                        const metaQ: any = { 
                            type: 'CUSTOM', 
                            label: label.substring(0, 200) 
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

                    // Deduplicate questions (don't add COMPANY_NAME twice if it's already there)
                    const seenTypes = new Set(['FULL_NAME', 'EMAIL', 'PHONE']);
                    metaCustomQuestions = metaCustomQuestions.filter(q => {
                        if (q.type === 'CUSTOM') return true;
                        if (seenTypes.has(q.type)) return false;
                        seenTypes.add(q.type);
                        return true;
                    });

                } catch (e) {
                    logToFile("Failed to parse custom questions", e);
                }
            }

            const finalFollowUpUrl = linkUrl || "https://adrolls.in"; // Fallback to prevent API crash

            const questionLabels = metaCustomQuestions
                .map(q => q.label || q.type)
                .filter(Boolean)
                .map(label => label.replace(/[?:]/g, '').trim())
                .join(', ');

            const formName = `Form - ${businessName} - (Name, Email, Phone${questionLabels ? `, ${questionLabels}` : ''}) - ${Date.now().toString().slice(-6)}`;

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
            
            leadFormId = formCreateData.id;
            logToFile(`✅ Lead Form Created: ${leadFormId}`);
        }

        // --- Step C: Upload Creatives (PROXY UPLOAD) ---
        logToFile("--- 3. UPLOADING ALL CREATIVES ---");
        interface UploadedCreative {
            type: 'image' | 'video';
            hash?: string;
            videoId?: string;
        }
        const uploadedCreatives: UploadedCreative[] = [];
        let globalThumbHash: string | null = null;

        // 1. Prepare global thumbnail hash if we have any videos
        const hasVideos = creativeItems.some(item => item.type === 'video');
        if (hasVideos) {
            logToFile("Preparing video thumbnail for campaign...");
            const thumbSource = targetProfile?.logo_url || 'https://adrolls.in/logo-square.png';
            try {
                const thumbFetch = await fetch(thumbSource);
                if (thumbFetch.ok) {
                    const thumbBlob = await thumbFetch.blob();
                    const thumbData = new FormData();
                    thumbData.append('source', thumbBlob, `thumb_${Date.now()}.png`);
                    thumbData.append('access_token', facebookToken);
                    const thumbRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, { method: 'POST', body: thumbData });
                    const thumbResult = await thumbRes.json();
                    if (thumbResult.images) {
                        globalThumbHash = thumbResult.images[Object.keys(thumbResult.images)[0]].hash;
                        logToFile(`Prepared global thumbnail hash: ${globalThumbHash}`);
                    }
                }
            } catch (thumbErr: any) {
                logToFile("Failed to prepare video thumbnail:", thumbErr.message);
            }
        }

        // 2. Upload each creative item
        let firstUploadError: any = null;
        for (let i = 0; i < creativeItems.length; i++) {
            const item = creativeItems[i];
            try {
                if (item.type === 'video') {
                    const videoData = new FormData();
                    if (item.file) {
                        videoData.append('source', item.file, (item.file as any).name || 'video.mp4');
                    } else if (item.url) {
                        videoData.append('file_url', item.url);
                    }
                    videoData.append('access_token', facebookToken);
                    
                    logToFile(`Uploading video ${i + 1} to Meta...`);
                    const videoRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/advideos`, { method: 'POST', body: videoData });
                    const videoResult = await videoRes.json();
                    
                    if (videoResult.id) {
                        logToFile(`✅ Video ${i + 1} uploaded. ID: ${videoResult.id}`);
                        uploadedCreatives.push({
                            type: 'video',
                            videoId: videoResult.id
                        });
                    } else {
                        logToFile(`❌ Video ${i + 1} upload failed:`, videoResult);
                        firstUploadError = videoResult.error || { message: "Video upload failed" };
                    }
                } else {
                    const imgData = new FormData();
                    if (item.file) {
                        imgData.append('source', item.file, (item.file as any).name || 'image.png');
                    } else if (item.url) {
                        const imgFetch = await fetch(item.url);
                        if (!imgFetch.ok) {
                            logToFile(`❌ Failed to fetch image URL: ${item.url}`);
                            continue;
                        }
                        const imgBlob = await imgFetch.blob();
                        imgData.append('source', imgBlob, 'image.png');
                    }
                    imgData.append('access_token', facebookToken);
                    
                    logToFile(`Uploading image ${i + 1} to Meta...`);
                    const imgRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, { method: 'POST', body: imgData });
                    const imgResult = await imgRes.json();
                    
                    if (imgResult.images) {
                        const hash = imgResult.images[Object.keys(imgResult.images)[0]].hash;
                        logToFile(`✅ Image ${i + 1} uploaded. Hash: ${hash}`);
                        uploadedCreatives.push({
                            type: 'image',
                            hash: hash
                        });
                        
                        if (!globalThumbHash) {
                            globalThumbHash = hash;
                        }
                    } else {
                        logToFile(`❌ Image ${i + 1} upload failed:`, imgResult);
                        firstUploadError = imgResult.error || { message: "Image upload failed" };
                    }
                }
            } catch (err: any) {
                logToFile(`Error uploading creative item ${i + 1}:`, err.message);
                firstUploadError = { message: err.message };
            }
        }

        if (uploadedCreatives.length === 0) {
            if (firstUploadError) {
                const title = firstUploadError.error_user_title ? `${firstUploadError.error_user_title}: ` : "";
                const msg = firstUploadError.error_user_msg || firstUploadError.message || "Unknown error";
                throw new Error(`Creative upload failed. Meta API Error: ${title}${msg}`);
            }
            throw new Error("Creative upload failed. Could not upload any images or videos to Facebook.");
        }

        if (uploadedCreatives.some(c => c.type === 'video')) {
            logToFile("Waiting 5 seconds for Meta to process uploaded videos...");
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        logToFile(`✅ Uploaded ${uploadedCreatives.length} creatives to Meta.`);

        // --- Step D: AI Copywriting (Batch Processing) ---
        logToFile("--- 4. AI COPYWRITING (BATCHING) ---");
        
        // Prepare Vision Inputs (Multimodal)
        const visionInputs: string[] = [];
        
        // Add public URLs from inventory/assets (Converted to Base64 for reliability)
        if (inventoryIds.length > 0) {
             const { data: props } = await supabase.from('properties').select('image_url').in('id', inventoryIds);
             for (const p of (props || [])) {
                 if (p.image_url) {
                    try {
                        const res = await fetch(p.image_url);
                        const buf = await res.arrayBuffer();
                        const mime = res.headers.get('content-type') || 'image/png';
                        visionInputs.push(`data:${mime};base64,${Buffer.from(buf).toString('base64')}`);
                    } catch (e) {
                        logToFile("Failed to convert inventory image to base64:", p.image_url);
                    }
                 }
             }
        }
        if (assetIds.length > 0) {
             const { data: asts } = await supabase.from('assets').select('url').in('id', assetIds);
             for (const a of (asts || [])) {
                 if (a.url) {
                    try {
                        const res = await fetch(a.url);
                        const buf = await res.arrayBuffer();
                        const mime = res.headers.get('content-type') || 'image/png';
                        visionInputs.push(`data:${mime};base64,${Buffer.from(buf).toString('base64')}`);
                    } catch (e) {
                        logToFile("Failed to convert asset image to base64:", a.url);
                    }
                 }
             }
        }
        // Add Local files as Base64
        for (const file of creativeFiles) {
             const arr = await file.arrayBuffer();
             visionInputs.push(`data:${file.type};base64,${Buffer.from(arr).toString('base64')}`);
        }

        const contactInfo = data.contact_number || "";
        
        let allCopyVariations: any[] = [];
        const BATCH_SIZE = 10;
        const totalToGenerate = uploadedCreatives.length;

        for (let batchStart = 0; batchStart < totalToGenerate; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE, totalToGenerate);
            const batchImages = visionInputs.slice(batchStart, batchEnd);
            const batchCount = batchEnd - batchStart;

            const batchPrompt = `
            Act as a Senior Ad Creative Director. Craft exactly ${batchCount} distinct, highly persuasive ad copy variations for the ${batchCount} images provided in this batch.
            
            Business Context:
            Name: ${businessName}
            Contact: ${contactInfo}
            Mission: ${combinedContext || "Quality services and products."}
            
            CRITICAL RULES:
            1. MANDATORY: INCLUDE BUSINESS NAME (${businessName}) AND CONTACT (${contactInfo}) IN EVERY VARIATION.
            2. DO NOT include URLs or hashtags.
            3. LENGTH: Moderate (max 400 chars).
            4. FORMAT: Return ONLY a valid JSON array of objects.
            
            JSON Structure:
            [
              {"primary_text": "...", "headline": "...", "description": "..."}
            ]
            (Generate exactly ${batchCount} objects)
            `;

            try {
                logToFile(`--- Batch ${batchStart / BATCH_SIZE + 1} Input ---`, { count: batchCount, images: batchImages.length });
                const aiRaw = await callGemini(batchPrompt, batchImages);
                
                const cleanedText = aiRaw
                    .replace(/```json\s*/g, '')
                    .replace(/\s*```/g, '')
                    .replace(/\*\*/g, '');

                const jsonMatch = cleanedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
                const cleanedJson = jsonMatch ? jsonMatch[0] : cleanedText.trim();
                
                const parsed = JSON.parse(cleanedJson);
                if (Array.isArray(parsed)) {
                    allCopyVariations = [...allCopyVariations, ...parsed];
                    logToFile(`✅ Batch ${batchStart / BATCH_SIZE + 1} Done: ${parsed.length} variations.`);
                }
            } catch (e: any) {
                logToFile(`❌ Batch ${batchStart / BATCH_SIZE + 1} Failed:`, e.message || e);
                // Fallback for this batch
                for (let k = 0; k < batchCount; k++) {
                    allCopyVariations.push({ 
                        primary_text: "Exclusive Property Deal. Contact us for details.", 
                        headline: "Limited Time Offer",
                        description: "View details and pricing now."
                    });
                }
            }
        }

        const copyVariations = allCopyVariations.length > 0 ? allCopyVariations : [
            { primary_text: "Exclusive Property Deal. View pricing & details now.", headline: "View Details", description: "Special offer available today." }
        ];

        // --- Step E: Campaign ---
        logToFile("--- 5. CAMPAIGN ---");
        
        let propertyTitle = "";
        if (inventoryIds.length > 0) {
            try {
                const { data: prop } = await supabase
                    .from('properties')
                    .select('title')
                    .eq('id', inventoryIds[0])
                    .single();
                if (prop?.title) {
                    propertyTitle = prop.title;
                }
            } catch (e) {}
        }
        
        const campaignName = `${businessName} - ${customAudienceIds.length > 0 ? 'Retargeting' : (propertyTitle || "AI Smart Campaign")} - ${new Date().toISOString().slice(0, 10)} - ${Date.now().toString().slice(-4)}`;

        const campaignPayload = {
            name: campaignName,
            objective: 'OUTCOME_LEADS', 
            status: 'ACTIVE', 
            buying_type: 'AUCTION',
            daily_budget: Math.round(dailyBudget * 100), // Budget in smallest unit (Cents/Paise)
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
        let targetingConfig: any = { geo_locations: { countries: ['IN'], location_types: ['home'] } }; 
        
        if (metaLocationsStr) {
            try {
                const locationsArray = JSON.parse(metaLocationsStr);
                if (Array.isArray(locationsArray) && locationsArray.length > 0) {
                    targetingConfig = { geo_locations: { cities: [], regions: [], countries: [], zips: [], location_types: ['home'] } };
                    
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

        // Apply smart targeting constraints and placements (matching high-performing campaigns)
        // Meta's Advantage+ Audience requires age_min <= 25 and age_max >= 65 for hard controls
        targetingConfig.age_min = ageMin !== undefined && ageMin !== null ? Math.min(ageMin, 25) : 18;
        targetingConfig.age_max = 65;
        targetingConfig.targeting_relaxation_types = {
            custom_audience: 1,
            lookalike: 1
        };
        targetingConfig.targeting_automation = {
            advantage_audience: 1 // Enable Advantage+ Audience
        };
        targetingConfig.device_platforms = ['mobile', 'desktop'];
        targetingConfig.publisher_platforms = ['facebook', 'instagram']; // Exclude messenger for higher lead quality

        // --- Step F: Ad Set ---
        logToFile("--- 6. AD SET ---");
        const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); 

        const customEventType = 'LEAD';

        const adSetPayload: any = {
            name: customAudienceIds.length > 0 ? `Retargeting AdSet - Custom Audiences` : `Smart AdSet - AI Audiences`,
            campaign_id: campaignId,
            billing_event: 'IMPRESSIONS', 
            targeting: {
                ...targetingConfig,
                ...(customAudienceIds.length > 0 ? {
                    custom_audiences: customAudienceIds.map((id: string) => ({ id }))
                } : {})
            },
            start_time: startTime, 
            status: 'ACTIVE',
            access_token: facebookToken,
        };

        if (isWebsiteCampaign) {
            adSetPayload.destination_type = 'WEBSITE';
            adSetPayload.optimization_goal = 'OFFSITE_CONVERSIONS';
            adSetPayload.promoted_object = { 
                pixel_id: finalPixelId, 
                custom_event_type: customEventType 
            };
            logToFile(`Website conversion campaign configured. Pixel: ${finalPixelId}, Event: ${customEventType}`);
        } else {
            adSetPayload.destination_type = 'ON_AD';
            adSetPayload.optimization_goal = optimizeForConversions ? 'QUALITY_LEAD' : 'LEAD_GENERATION';
            adSetPayload.promoted_object = { page_id: pageId };
            logToFile(`Instant Form lead campaign configured.`);
        }

        const adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adSetPayload),
        });
        
        const adSetData = await adSetRes.json();
        if (!adSetRes.ok) {
            logToFile("❌ Ad Set Creation Failed:", adSetData);
            const metaErr = adSetData.error || {};
            return NextResponse.json({ 
                error: `Ad Set Error: ${metaErr.message}`,
                metaError: {
                    message: metaErr.message,
                    type: metaErr.type,
                    code: metaErr.code,
                    error_subcode: metaErr.error_subcode,
                    error_user_title: metaErr.error_user_title,
                    error_user_msg: metaErr.error_user_msg,
                    fbtrace_id: metaErr.fbtrace_id
                }
            }, { status: 400 });
        }
        const adSetId = adSetData.id;

        // --- Step G & H: Loop Creatives & Final Ads ---
        logToFile("--- 7. GENERATING MULTIPLE ADS ---");
        
        let successfulAds = 0;
        let lastDraftError = null;

        // Ensure we create exactly as many ads as selected creatives
        const totalAdsToCreate = uploadedCreatives.length;
        
        for (let i = 0; i < totalAdsToCreate; i++) {
            // Cycle through unique assets and unique copy
            const creativeItem = uploadedCreatives[i % uploadedCreatives.length];
            const copy = copyVariations[i % copyVariations.length];

            const ctaValue: any = {};
            if (isWebsiteCampaign) {
                ctaValue.link = linkUrl;
            } else {
                ctaValue.lead_gen_form_id = leadFormId;
                ctaValue.link = linkUrl;
            }

            // Create Creative
            const creativePayload: any = {
                name: `Creative ${i + 1} - ${Date.now()}`,
                object_story_spec: {
                    page_id: pageId, 
                },
                access_token: facebookToken,
            };

            if (creativeItem.type === 'video') {
                creativePayload.object_story_spec.video_data = {
                    video_id: creativeItem.videoId,
                    message: copy.primary_text || "View our latest video.",
                    title: copy.headline || "View Details",
                    image_hash: globalThumbHash, // Meta requires a thumbnail
                    call_to_action: {
                        type: 'LEARN_MORE',
                        value: ctaValue
                    }
                };
            } else {
                creativePayload.object_story_spec.link_data = {
                    message: copy.primary_text || "View our latest property.", 
                    name: copy.headline || "View Details", 
                    description: copy.description || "",
                    link: linkUrl, 
                    image_hash: creativeItem.hash, 
                    call_to_action: { type: 'LEARN_MORE', value: ctaValue }
                };
            }

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

            // NEW: Persist generated copy back to assets table for future Strategist use
            try {
                const assetId = assetIds[i % assetIds.length];
                if (assetId) {
                    const fullCaption = `${copy.headline}\n\n${copy.primary_text}${copy.description ? `\n\n${copy.description}` : ''}`;
                    await supabase.from('assets').update({ caption: fullCaption }).eq('id', assetId);
                }
            } catch (persistErr) {
                logToFile("Failed to persist copy to assets table:", persistErr);
            }

            // Create Ad
            const adPayload = {
                name: `AI Ad Variation ${i + 1}`,
                adset_id: adSetId,
                creative: { creative_id: creativeData.id },
                status: 'ACTIVE', 
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
        
        // REFUND: Give back the campaign launch credit if the process failed
        if (user?.id) {
            await refundLimit(user.id, 'campaign_launches');
        }

        return NextResponse.json(
            { error: error.message || "Internal Server Error" }, 
            { status: 500 }
        );
    }
}