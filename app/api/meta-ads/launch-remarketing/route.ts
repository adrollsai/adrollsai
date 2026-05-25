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

    // --- SUBSCRIPTION CHECK (Always deduct from the authenticated user) ---
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
        data.sourceCampaignId = formData.get('sourceCampaignId')?.toString();
        data.sourceCampaignName = formData.get('sourceCampaignName')?.toString();
        
        data.creativeFiles = [];
        formData.forEach((value, key) => {
            if (key.startsWith('creativeFiles[') && value instanceof Blob) {
                data.creativeFiles.push(value);
            }
        });
    }

    // Fetch TARGET profile for credentials and business info
    const { data: targetProfile } = await supabase.from('profiles')
        .select('facebook_token, ad_account_id, fb_page_id, business_url, business_name, contact_number, currency')
        .eq('id', targetUserId)
        .single();

    if (targetProfile) {
        data.facebookToken = data.facebookToken || targetProfile.facebook_token;
        data.adAccountId = data.adAccountId || targetProfile.ad_account_id;
        data.pageId = data.pageId || targetProfile.fb_page_id;
        data.linkUrl = data.linkUrl || targetProfile.business_url;
        data.privacyPolicyUrl = data.privacyPolicyUrl || (targetProfile.business_url ? `${targetProfile.business_url}/privacy` : '');
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
        sourceCampaignId,
        sourceCampaignName = 'Campaign'
    } = data;
    
    const currency = targetProfile?.currency || 'INR';

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

    logToFile("=== STARTING AI RETARGETING CAMPAIGN LAUNCH ===");

    // --- Step 0. Fetch Qualified CRM Leads ---
    logToFile("--- 0a. FETCHING CRM LEADS ---");
    const { data: qualifiedLeads, error: leadsErr } = await supabase
        .from('leads')
        .select('email, phone')
        .eq('user_id', targetUserId)
        .in('pipeline_stage', ['Qualified', 'Appointment booked', 'Appointment done', 'Closed']);

    if (leadsErr) {
        logToFile(`LEADS FETCH ERROR: ${leadsErr.message}`);
        await refundLimit(user.id, 'campaign_launches');
        return NextResponse.json({ error: `Failed to fetch qualified CRM leads: ${leadsErr.message}` }, { status: 500 });
    }

    if (!qualifiedLeads || qualifiedLeads.length === 0) {
        await refundLimit(user.id, 'campaign_launches');
        return NextResponse.json({ 
            error: "No qualified CRM leads found. You must have at least one lead in 'Qualified', 'Appointment booked', 'Appointment done', or 'Closed' stages to launch a retargeting campaign." 
        }, { status: 400 });
    }

    logToFile(`Found ${qualifiedLeads.length} qualified CRM leads.`);

    // --- Step 0b. Create Meta Custom Audience ---
    logToFile("--- 0b. CREATING CUSTOM AUDIENCE ---");
    const customAudienceName = `CRM Qualified Leads - ${sourceCampaignName} - ${new Date().toISOString().slice(0, 10)}`;
    const customAudiencePayload = {
        name: customAudienceName,
        subtype: "CUSTOM",
        customer_file_source: "USER_PROVIDED_ONLY",
        description: `Dynamic retargeting audience of qualified leads from CRM for source campaign: ${sourceCampaignName}.`,
        access_token: facebookToken
    };

    const audienceRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/customaudiences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customAudiencePayload)
    });

    const audienceData = await audienceRes.json();
    if (!audienceRes.ok) {
        logToFile("❌ Custom Audience Creation Failed:", audienceData);
        await refundLimit(user.id, 'campaign_launches');
        const metaErr = audienceData.error?.message || "Unknown error";
        return NextResponse.json({ error: `Meta Custom Audience Error: ${metaErr}` }, { status: 400 });
    }

    const customAudienceId = audienceData.id;
    logToFile(`✅ Custom Audience Created: ${customAudienceId}`);

    // --- Step 0c. Hash and Upload Contacts ---
    logToFile("--- 0c. HASHING AND UPLOADING CONTACTS ---");
    const crypto = await import('crypto');
    const dataRows: string[][] = [];

    const cleanAndHashPhone = (phoneStr: string) => {
        const digits = phoneStr.replace(/[^0-9]/g, '');
        if (!digits) return '';
        return crypto.createHash('sha256').update(digits).digest('hex');
    };

    const hashEmail = (emailStr: string) => {
        const clean = emailStr.trim().toLowerCase();
        if (!clean) return '';
        return crypto.createHash('sha256').update(clean).digest('hex');
    };

    for (const lead of qualifiedLeads) {
        const emailHash = lead.email ? hashEmail(lead.email) : '';
        const phoneHash = lead.phone ? cleanAndHashPhone(lead.phone) : '';
        if (emailHash || phoneHash) {
            dataRows.push([emailHash, phoneHash]);
        }
    }

    if (dataRows.length === 0) {
        await refundLimit(user.id, 'campaign_launches');
        return NextResponse.json({ error: "None of the qualified CRM leads have a valid email or phone number to retarget." }, { status: 400 });
    }

    const uploadPayload = {
        payload: {
            schema: ["EMAIL", "PHONE"],
            data: dataRows
        },
        access_token: facebookToken
    };

    const uploadRes = await fetch(`${FB_MARKETING_URL}/${customAudienceId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(uploadPayload)
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) {
        logToFile("❌ Custom Audience Leads Upload Failed:", uploadData);
        await refundLimit(user.id, 'campaign_launches');
        const metaErr = uploadData.error?.message || "Unknown error";
        return NextResponse.json({ error: `Meta Leads Upload Error: ${metaErr}` }, { status: 400 });
    }

    logToFile(`✅ Uploaded ${uploadData.num_received} contacts to custom audience.`);

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
        
        let metaCustomQuestions: any[] = [];
        if (customQuestionsStr && customQuestionsStr !== "[]") {
            try {
                const parsedQuestions = JSON.parse(customQuestionsStr);
                metaCustomQuestions = parsedQuestions.map((q: any) => {
                    const label = q.label.trim();
                    const lowerLabel = label.toLowerCase();
                    
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

        const finalFollowUpUrl = linkUrl || "https://adrolls.in";

        // Dynamic and Distinguishable Lead Form name based on custom questions
        const businessName = data.business_name || "Our Business";
        const questionLabels = metaCustomQuestions
            .map(q => q.label || q.type)
            .filter(Boolean)
            .map(label => label.replace(/[?:]/g, '').trim())
            .join(', ');

        const formName = `Form - Retargeting - ${businessName} - (Name, Email, Phone${questionLabels ? `, ${questionLabels}` : ''}) - ${Date.now().toString().slice(-6)}`;

        const leadFormPayload: any = {
            name: formName,
            follow_up_action_url: finalFollowUpUrl, 
            question_page_custom_headline: `Welcome Back! Get Premium Access`,
            question_page_custom_text: "Confirm your details to get priority scheduling & exclusive pricing.",
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

        logToFile("--- 2b. RETARGETING LEAD FORM PAYLOAD ---", leadFormPayload);

        const formCreateRes = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json; charset=utf-8' 
            },
            body: JSON.stringify(leadFormPayload)
        });
        
        const formCreateData = await formCreateRes.json();

        if (!formCreateRes.ok) {
            logToFile("❌ Retargeting Lead Form Creation Failed:", formCreateData);
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
            const uniqueUrls = Array.from(new Set(initialImageUrls));
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

        // --- Step D: Retargeting AI Copywriting ---
        logToFile("--- 4. RETARGETING AI COPYWRITING ---");
        
        const visionInputs: string[] = [];
        
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
        for (const file of creativeFiles) {
             const arr = await file.arrayBuffer();
             visionInputs.push(`data:${file.type};base64,${Buffer.from(arr).toString('base64')}`);
        }

        const contactInfo = data.contact_number || "";
        const retargetingContext = `
        This is a REMARKETING/RETARGETING campaign targeting qualified CRM leads who have previously interacted, shown interest, or requested details, but have not fully completed their transaction or scheduled their final appointment. 
        Original Campaign Name: ${sourceCampaignName}. 
        Use an extremely warm, trust-building, premium tone, referencing their existing interest, addressing potential friction/objections, and offering high-value follow-ups, priority access, or exclusive VIP tours/consultations.
        `;
        
        let allCopyVariations: any[] = [];
        const BATCH_SIZE = 10;
        const totalToGenerate = metaCreativeHashes.length;

        for (let batchStart = 0; batchStart < totalToGenerate; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE, totalToGenerate);
            const batchImages = visionInputs.slice(batchStart, batchEnd);
            const batchCount = batchEnd - batchStart;

            const batchPrompt = `
            Act as a Senior Ad Creative Director. Craft exactly ${batchCount} distinct, highly persuasive retargeting ad copy variations for the ${batchCount} images provided in this batch.
            
            Business Context:
            Name: ${businessName}
            Contact: ${contactInfo}
            Retargeting Context: ${retargetingContext}
            Mission: ${combinedContext || "Quality services and products."}
            
            CRITICAL RULES:
            1. MANDATORY: INCLUDE BUSINESS NAME (${businessName}) AND CONTACT (${contactInfo}) IN EVERY VARIATION.
            2. DO NOT include URLs or hashtags.
            3. LENGTH: Moderate (max 400 chars).
            4. TONE: Warm, objection-handling, trust-building. Focus on social proof or exclusive access.
            5. FORMAT: Return ONLY a valid JSON array of objects.
            
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
                for (let k = 0; k < batchCount; k++) {
                    allCopyVariations.push({ 
                        primary_text: `Welcome back to ${businessName}. As a qualified client, contact us to get priority pricing and scheduled viewings today!`, 
                        headline: "Priority Premium Access",
                        description: "Exclusive details for our registered clients."
                    });
                }
            }
        }

        const copyVariations = allCopyVariations.length > 0 ? allCopyVariations : [
            { primary_text: `Welcome back to ${businessName}. Contact us today to receive registered client premium benefits.`, headline: "Exclusive Client Access", description: "View details and pricing now." }
        ];

        // --- Step E: Campaign ---
        logToFile("--- 5. RETARGETING CAMPAIGN ---");
        
        // Distinguishable Campaign Naming
        const campaignName = `${businessName} - Retargeting - CRM Qualified Leads - ${sourceCampaignName} - ${new Date().toISOString().slice(0, 10)}`;

        const campaignPayload = {
            name: campaignName,
            objective: 'OUTCOME_LEADS', 
            status: 'ACTIVE', 
            buying_type: 'AUCTION',
            daily_budget: Math.round(dailyBudget * 100), 
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            special_ad_categories: [], 
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

        // --- Step F: Ad Set targeting custom audience ---
        logToFile("--- 6. AD SET ---");
        const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); 

        const adSetPayload: any = {
            name: `Retargeting AdSet - CRM Qualified Leads`,
            campaign_id: campaignId,
            destination_type: 'ON_AD', 
            optimization_goal: optimizeForConversions ? 'QUALITY_LEAD' : 'LEAD_GENERATION', 
            billing_event: 'IMPRESSIONS', 
            targeting: {
                ...targetingConfig,
                custom_audiences: [{ id: customAudienceId }]
            },
            promoted_object: { page_id: pageId },
            start_time: startTime, 
            status: 'ACTIVE',
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

        const totalAdsToCreate = metaCreativeHashes.length;
        
        for (let i = 0; i < totalAdsToCreate; i++) {
            const hash = metaCreativeHashes[i % metaCreativeHashes.length];
            const copy = copyVariations[i % copyVariations.length];

            // Create Creative
            const creativePayload = {
                name: `Retargeting Creative ${i + 1} - ${Date.now()}`,
                object_story_spec: {
                    page_id: pageId, 
                    link_data: {
                        message: copy.primary_text || "Welcome back! View our exclusive client details.", 
                        name: copy.headline || "VIP Premium Access", 
                        description: copy.description || "",
                        link: linkUrl, 
                        image_hash: hash, 
                        call_to_action: { type: 'LEARN_MORE', value: { lead_gen_form_id: leadFormId } }
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
                continue; 
            }

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
                name: `Retargeting AI Ad Variation ${i + 1}`,
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
                message: "Retargeting Campaign DRAFTED! \n\n⚠️ Payment Method Missing: Saved in Ads Manager." 
            });
        }

        return NextResponse.json({ 
            success: true, 
            campaignId: campaignId, 
            message: `Retargeting Campaign Launched Successfully with ${successfulAds} AI Optimized Ads!` 
        });

    } catch (error: any) {
        logToFile("!!! API CRASH !!!", error.message);
        
        if (user?.id) {
            await refundLimit(user.id, 'campaign_launches');
        }

        return NextResponse.json(
            { error: error.message || "Internal Server Error" }, 
            { status: 500 }
        );
    }
}
