import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { callGemini } from '@/utils/external-apis';
import { checkLimitAndIncrement, refundLimit } from '@/utils/subscription-server';

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

import { logToFile, clearLogFile } from '@/utils/logger';

// Extend Vercel serverless function timeout for heavy Meta API operations
export const maxDuration = 120;

export async function POST(request: Request) {
    clearLogFile();

    try {
        const { createClient: createAdminClient } = await import('@supabase/supabase-js');
        const supabaseAdmin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        let user: any = null;
        const mockUserHeader = request.headers.get('X-Mock-User');
        if (mockUserHeader && !process.env.VERCEL) {
            user = { id: mockUserHeader };
        } else {
            const clientSupabase = await createClient();
            const { data: { user: authUser } } = await clientSupabase.auth.getUser();
            user = authUser;
        }

        if (!user) {
            return NextResponse.json(
                { error: 'Unauthorized' }, 
                { status: 401 }
            );
        }

        // --- 0. Resolve Target User ID ---
        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');
        const { data: ownProfile } = await supabaseAdmin.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
        let targetUserId = user.id;

        if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
            targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
        }

        if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
            if (ownProfile?.role !== 'super_admin') {
                const isParent = (ownProfile?.agency_id === impersonateId || ownProfile?.parent_id === impersonateId);
                const { data: subAccount } = await supabaseAdmin.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', ownProfile?.agency_id || user.id).single();

                if (isParent || subAccount) {
                    targetUserId = impersonateId;
                } else {
                    return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
                }
            } else {
                targetUserId = impersonateId;
            }
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
        data.campaignType = formData.get('campaignType')?.toString();
        data.pixelId = formData.get('pixelId')?.toString();
        
        const ageMinVal = formData.get('ageMin');
        if (ageMinVal) data.ageMin = parseInt(ageMinVal.toString());
        const ageMaxVal = formData.get('ageMax');
        if (ageMaxVal) data.ageMax = parseInt(ageMaxVal.toString());

        data.creativeFiles = [];
        formData.forEach((value, key) => {
            if (key.startsWith('creativeFiles[') && value instanceof Blob) {
                data.creativeFiles.push(value);
            }
        });
    }

    // Fetch TARGET profile for credentials and business info
    const { data: targetProfile } = await supabaseAdmin.from('profiles')
        .select('facebook_token, ad_account_id, selected_page_id, custom_domain, business_name, contact_number, currency, pixel_id, logo_url')
        .eq('id', targetUserId)
        .single();

    if (targetProfile) {
        data.facebookToken = data.facebookToken || targetProfile.facebook_token;
        data.adAccountId = data.adAccountId || targetProfile.ad_account_id;
        data.pageId = data.pageId || targetProfile.selected_page_id;
        
        const targetBusinessUrl = targetProfile.custom_domain 
            ? `https://${targetProfile.custom_domain}` 
            : `https://app.nobogent.com/shared/${targetUserId}`;

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
        sourceCampaignId,
        sourceCampaignName = 'Campaign',
        campaignType = 'instant_form',
        pixelId,
        ageMin,
        ageMax
    } = data;
    
    const currency = targetProfile?.currency || 'INR';

    const finalPixelId = pixelId || targetProfile?.pixel_id || null;
    const isWebsiteCampaign = campaignType === 'website_conversion';

    if (isWebsiteCampaign && !finalPixelId) {

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

    // Guarantee Page is subscribed to Meta webhooks for real-time lead ingestion
    fetch(`https://graph.facebook.com/v20.0/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${facebookToken}`, {
        method: 'POST'
    }).catch(() => {});

    // --- Step 00. Check Meta Custom Audience Terms of Service ---
    logToFile("--- Checking Meta Custom Audience Terms of Service ---");
    const targetActId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const tosUrl = `https://graph.facebook.com/v19.0/${targetActId}?fields=tos_accepted&access_token=${facebookToken}`;
    
    let isCustomAudienceTosAccepted = false;
    let isWebCustomAudienceTosAccepted = false;
    
    try {
        const tosRes = await fetch(tosUrl);
        const tosData = await tosRes.json();
        
        if (tosData.tos_accepted) {
            isCustomAudienceTosAccepted = tosData.tos_accepted.custom_audience_tos === 1;
            isWebCustomAudienceTosAccepted = tosData.tos_accepted.web_custom_audience_tos === 1;
        } else {
            // If tos_accepted field is missing, check if there's an error
            if (tosData.error) {
                logToFile(`Error checking Meta TOS response: ${JSON.stringify(tosData.error)}`);
            }
        }
    } catch (tosErr: any) {
        logToFile(`Error checking Meta TOS: ${tosErr.message}`);
        // If the check fails for some network/API reason, we don't block the entire launch
        isCustomAudienceTosAccepted = true; 
        isWebCustomAudienceTosAccepted = true;
    }

    const cleanActId = targetActId.replace('act_', '');
    
    if (!isCustomAudienceTosAccepted || !isWebCustomAudienceTosAccepted) {

        
        const acceptUrl = `https://www.facebook.com/customaudiences/app/tos/?act=${cleanActId}`;
        const errorMsg = !isCustomAudienceTosAccepted && !isWebCustomAudienceTosAccepted
            ? `Meta Custom Audience and Web Pixel Terms of Service have not been accepted for this Ad Account. Please visit this link to accept the terms, then try again: ${acceptUrl}`
            : !isCustomAudienceTosAccepted
                ? `Meta Custom Audience Terms of Service (for customer list uploads) have not been accepted. Please visit this link to accept the terms, then try again: ${acceptUrl}`
                : `Meta Web Pixel Custom Audience Terms of Service have not been accepted. Please visit this link to accept the terms, then try again: ${acceptUrl}`;

        return NextResponse.json(
            { 
                error: errorMsg,
                tosLink: acceptUrl,
                error_subcode: 2663 
            }, 
            { status: 400 }
        );
    }

    logToFile("=== STARTING AI RETARGETING CAMPAIGN LAUNCH ===");

    // --- Step 0. Fetch Qualified CRM Leads ---
    logToFile("--- 0a. FETCHING CRM LEADS ---");
    let { data: qualifiedLeads, error: leadsErr } = await supabaseAdmin
        .from('leads')
        .select('email, phone')
        .eq('user_id', targetUserId)
        .in('pipeline_stage', ['New', 'Contacted', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'In Progress']);

    if (leadsErr || !qualifiedLeads || qualifiedLeads.length === 0) {
        // Fallback: Query all leads for targetUserId without pipeline_stage filter
        const { data: allLeads } = await supabaseAdmin
            .from('leads')
            .select('email, phone')
            .eq('user_id', targetUserId);

        if (allLeads && allLeads.length > 0) {
            qualifiedLeads = allLeads;
        }
    }

    if (leadsErr && (!qualifiedLeads || qualifiedLeads.length === 0)) {
        logToFile(`LEADS FETCH ERROR: ${leadsErr.message}`);
        return NextResponse.json({ error: `Failed to fetch qualified CRM leads: ${leadsErr.message}` }, { status: 500 });
    }

    if (!qualifiedLeads || qualifiedLeads.length === 0) {
        return NextResponse.json({ 
            error: "No CRM leads found to retarget. Please ensure you have leads in your CRM before launching a retargeting campaign." 
        }, { status: 400 });
    }

    logToFile(`Found ${qualifiedLeads.length} qualified CRM leads.`);

    // --- SUBSCRIPTION CHECK (Deduct campaign launch count since validation passed) ---
    try {
        await checkLimitAndIncrement(user.id, 'campaign_launches');
    } catch (limitErr: any) {
        logToFile(`QUOTA ERROR: ${limitErr.message}`);
        return NextResponse.json({ error: limitErr.message }, { status: 403 });
    }

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
    const targetCustomAudienceIds: string[] = [customAudienceId];

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

    // --- Step 0d. Create Additional Retargeting Custom Audiences ---
    let sourceVideoIds: string[] = [];
    let sourceFormIds: string[] = [];

    if (sourceCampaignId) {
        logToFile(`--- 0d. Fetching ads for source campaign: ${sourceCampaignId} ---`);
        try {
            const adsRes = await fetch(`${FB_MARKETING_URL}/${sourceCampaignId}/ads?fields=creative{id,video_id,object_story_spec}&access_token=${facebookToken}`);
            const adsData = await adsRes.json();
            
            if (adsData.data && Array.isArray(adsData.data)) {
                adsData.data.forEach((ad: any) => {
                    if (ad.creative) {
                        if (ad.creative.video_id) {
                            sourceVideoIds.push(ad.creative.video_id);
                        }
                        const spec = ad.creative.object_story_spec;
                        if (spec) {
                            const formIdFromLink = spec.link_data?.call_to_action?.value?.lead_gen_form_id;
                            if (formIdFromLink) sourceFormIds.push(formIdFromLink);

                            const formIdFromVideo = spec.video_data?.call_to_action?.value?.lead_gen_form_id;
                            if (formIdFromVideo) sourceFormIds.push(formIdFromVideo);

                            const videoIdFromSpec = spec.video_data?.video_id;
                            if (videoIdFromSpec) sourceVideoIds.push(videoIdFromSpec);
                        }
                    }
                });
                
                sourceVideoIds = Array.from(new Set(sourceVideoIds));
                sourceFormIds = Array.from(new Set(sourceFormIds));
                
                logToFile(`Found source video IDs: ${sourceVideoIds.join(', ')}`);
                logToFile(`Found source lead form IDs: ${sourceFormIds.join(', ')}`);
            }
        } catch (e: any) {
            logToFile(`Error fetching source campaign ads: ${e.message}`);
        }
    }

    // Create 95% Video Watchers Custom Audiences (video_completed is Meta's 95% milestone)
    for (const videoId of sourceVideoIds) {
        logToFile(`Creating 95% video view audience for video: ${videoId}`);
        const videoAudienceName = `Video Watchers 95% - Video ${videoId} - ${new Date().toISOString().slice(0, 10)}`;
        const rule = [
            {
                event_name: "video_completed",
                object_id: videoId
            }
        ];

        try {
            const res = await fetch(`${FB_MARKETING_URL}/${adAccountId}/customaudiences`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: videoAudienceName,
                    subtype: "ENGAGEMENT",
                    rule: JSON.stringify(rule),
                    prefill: 1,
                    access_token: facebookToken
                })
            });
            const resData = await res.json();
            if (res.ok && resData.id) {
                targetCustomAudienceIds.push(resData.id);
                logToFile(`✅ Video views custom audience created: ${resData.id}`);
            } else {
                logToFile(`❌ Video views custom audience creation failed for video ${videoId}:`, resData);
            }
        } catch (e: any) {
            logToFile(`Error creating video custom audience: ${e.message}`);
        }
    }

    // Create Lead Form Openers & Submitters Custom Audiences
    for (const formId of sourceFormIds) {
        // Opened Form Custom Audience
        logToFile(`Creating Opened Form audience for form: ${formId}`);
        const openedAudienceName = `Form Openers - Form ${formId} - ${new Date().toISOString().slice(0, 10)}`;
        const openedRule = {
            inclusions: {
                operator: "or",
                rules: [
                    {
                        event_sources: [
                            {
                                id: pageId,
                                type: "page"
                            }
                        ],
                        retention_seconds: 7776000, // 90 days
                        filter: {
                            operator: "and",
                            filters: [
                                {
                                    field: "event",
                                    operator: "eq",
                                    value: "lead_generation_opened"
                                },
                                {
                                    field: "form_id",
                                    operator: "eq",
                                    value: formId
                                }
                            ]
                        }
                    }
                ]
            }
        };

        try {
            const res = await fetch(`${FB_MARKETING_URL}/${adAccountId}/customaudiences`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: openedAudienceName,
                    rule: JSON.stringify(openedRule),
                    prefill: 1,
                    access_token: facebookToken
                })
            });
            const resData = await res.json();
            if (res.ok && resData.id) {
                targetCustomAudienceIds.push(resData.id);
                logToFile(`✅ Form Openers custom audience created: ${resData.id}`);
            } else {
                logToFile(`❌ Form Openers custom audience creation failed for form ${formId}:`, resData);
            }
        } catch (e: any) {
            logToFile(`Error creating form openers audience: ${e.message}`);
        }

        // Submitted Form Custom Audience
        logToFile(`Creating Submitted Form audience for form: ${formId}`);
        const submittedAudienceName = `Form Submitters - Form ${formId} - ${new Date().toISOString().slice(0, 10)}`;
        const submittedRule = {
            inclusions: {
                operator: "or",
                rules: [
                    {
                        event_sources: [
                            {
                                id: pageId,
                                type: "page"
                            }
                        ],
                        retention_seconds: 7776000, // 90 days
                        filter: {
                            operator: "and",
                            filters: [
                                {
                                    field: "event",
                                    operator: "eq",
                                    value: "lead_generation_submitted"
                                },
                                {
                                    field: "form_id",
                                    operator: "eq",
                                    value: formId
                                }
                            ]
                        }
                    }
                ]
            }
        };

        try {
            const res = await fetch(`${FB_MARKETING_URL}/${adAccountId}/customaudiences`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: submittedAudienceName,
                    rule: JSON.stringify(submittedRule),
                    prefill: 1,
                    access_token: facebookToken
                })
            });
            const resData = await res.json();
            if (res.ok && resData.id) {
                targetCustomAudienceIds.push(resData.id);
                logToFile(`✅ Form Submitters custom audience created: ${resData.id}`);
            } else {
                logToFile(`❌ Form Submitters custom audience creation failed for form ${formId}:`, resData);
            }
        } catch (e: any) {
            logToFile(`Error creating form submitters audience: ${e.message}`);
        }
    }

    // Create Website Visitors Custom Audience (using Pixel and Link URL)
    if (finalPixelId && linkUrl) {
        logToFile(`Creating Website Custom Audience for URL: ${linkUrl} using Pixel: ${finalPixelId}`);
        let matchValue = linkUrl;
        try {
            const parsedUrl = new URL(linkUrl);
            matchValue = parsedUrl.host + parsedUrl.pathname;
        } catch (urlErr) {
            // Keep raw URL if parsing fails
        }

        const websiteAudienceName = `Website Visitors - ${matchValue.substring(0, 40)} - ${new Date().toISOString().slice(0, 10)}`;
        const websiteRule = {
            inclusions: {
                operator: "or",
                rules: [
                    {
                        event_sources: [
                            {
                                id: finalPixelId,
                                type: "pixel"
                            }
                        ],
                        retention_seconds: 15552000, // 180 days
                        filter: {
                            operator: "and",
                            filters: [
                                {
                                    field: "url",
                                    operator: "i_contains",
                                    value: matchValue
                                }
                            ]
                        }
                    }
                ]
            }
        };

        try {
            const res = await fetch(`${FB_MARKETING_URL}/${adAccountId}/customaudiences`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: websiteAudienceName,
                    rule: JSON.stringify(websiteRule),
                    prefill: 1,
                    access_token: facebookToken
                })
            });
            const resData = await res.json();
            if (res.ok && resData.id) {
                targetCustomAudienceIds.push(resData.id);
                logToFile(`✅ Website Custom Audience created: ${resData.id}`);
            } else {
                logToFile(`❌ Website Custom Audience creation failed:`, resData);
            }
        } catch (e: any) {
            logToFile(`Error creating website custom audience: ${e.message}`);
        }
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
            const { data: props, error } = await supabaseAdmin
                .from('properties')
                .select('title, description, images, image_url')
                .in('id', inventoryIds);
            
            if (error) throw new Error("Failed to fetch property details.");
            
            if (props) {
                props.forEach((prop: any) => {
                    combinedContext += `Property: ${prop.title || 'N/A'}. Description: ${prop.description || 'N/A'}. `;
                    if (prop.images && Array.isArray(prop.images) && prop.images.length > 0) {
                        prop.images.forEach((img: any) => {
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
            logToFile("Preparing video thumbnail for retargeting campaign...");
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
                    let videoId: string | null = null;
                    let uploadError: any = null;

                    // If it is a direct file upload in request body
                    if (item.file) {
                        try {
                            logToFile(`Uploading uploaded video file ${i + 1} to Meta...`);
                            const videoData = new FormData();
                            videoData.append('source', item.file, (item.file as any).name || 'video.mp4');
                            videoData.append('access_token', facebookToken);

                            const videoRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/advideos`, { method: 'POST', body: videoData });
                            const resText = await videoRes.text();
                            let videoResult: any = {};
                            try {
                                videoResult = JSON.parse(resText);
                            } catch (parseErr) {
                                throw new Error(`Failed to parse Meta response as JSON (Status ${videoRes.status}): ${resText.substring(0, 500)}`);
                            }
                            if (videoResult.id) {
                                videoId = videoResult.id;
                            } else {
                                uploadError = videoResult.error || { message: `Direct video file upload failed (Status ${videoRes.status}): ${resText}` };
                            }
                        } catch (e: any) {
                            uploadError = { message: e.message };
                        }
                    } else if (item.url) {
                        // 1. Try uploading to Meta via file_url if the URL is public and remote
                        const isPublicUrl = item.url.startsWith('http') && !item.url.includes('localhost') && !item.url.includes('127.0.0.1') && !item.url.includes('::1');
                        
                        if (isPublicUrl) {
                            try {
                                logToFile(`Uploading video ${i + 1} via Meta file_url (JSON): ${item.url}`);
                                const videoRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/advideos`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        file_url: item.url,
                                        access_token: facebookToken
                                    })
                                });
                                
                                const resText = await videoRes.text();
                                logToFile(`Meta file_url response status for video ${i + 1}: ${videoRes.status}`);
                                
                                let videoResult: any = {};
                                try {
                                    videoResult = JSON.parse(resText);
                                } catch (parseErr) {
                                    throw new Error(`Failed to parse Meta response as JSON (Status ${videoRes.status}): ${resText.substring(0, 500)}`);
                                }
                                
                                if (videoResult.id) {
                                    videoId = videoResult.id;
                                    logToFile(`Successfully uploaded video ${i + 1} via file_url. Meta ID: ${videoId}`);
                                } else {
                                    uploadError = videoResult.error || { message: `file_url upload failed (Status ${videoRes.status}): ${resText}` };
                                    logToFile(`Meta file_url upload failed for video ${i + 1}:`, uploadError);
                                }
                            } catch (e: any) {
                                uploadError = { message: e.message };
                                logToFile(`Error uploading video ${i + 1} via file_url: ${e.message}`);
                            }
                        }

                        // 2. Fallback to downloading video and doing a binary upload if file_url failed or is local
                        if (!videoId) {
                            try {
                                logToFile(`Falling back to downloading video ${i + 1} for binary upload: ${item.url}`);
                                const controller = new AbortController();
                                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

                                const videoFetch = await fetch(item.url, { signal: controller.signal });
                                if (!videoFetch.ok) {
                                    throw new Error(`Failed to fetch video file from storage: ${videoFetch.statusText}`);
                                }
                                const videoBlob = await videoFetch.blob();
                                clearTimeout(timeoutId);

                                const videoData = new FormData();
                                videoData.append('source', videoBlob, 'video.mp4');
                                videoData.append('access_token', facebookToken);

                                const videoRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/advideos`, { method: 'POST', body: videoData });
                                const resText = await videoRes.text();
                                logToFile(`Meta binary fallback response status for video ${i + 1}: ${videoRes.status}`);
                                
                                let videoResult: any = {};
                                try {
                                    videoResult = JSON.parse(resText);
                                } catch (parseErr) {
                                    throw new Error(`Failed to parse Meta binary response as JSON (Status ${videoRes.status}): ${resText.substring(0, 500)}`);
                                }
                                
                                if (videoResult.id) {
                                    videoId = videoResult.id;
                                    logToFile(`Successfully uploaded video ${i + 1} via binary upload fallback. Meta ID: ${videoId}`);
                                } else {
                                    uploadError = videoResult.error || { message: `Binary fallback upload failed (Status ${videoRes.status}): ${resText}` };
                                    logToFile(`Binary fallback upload failed for video ${i + 1}:`, uploadError);
                                }
                            } catch (e: any) {
                                uploadError = { message: e.message };
                                logToFile(`Error during binary video upload fallback for video ${i + 1}: ${e.message}`);
                            }
                        }
                    }

                    if (videoId) {
                        logToFile(`✅ Video ${i + 1} uploaded. ID: ${videoId}`);
                        uploadedCreatives.push({
                            type: 'video',
                            videoId: videoId
                        });
                    } else {
                        logToFile(`❌ Video ${i + 1} upload failed:`, uploadError);
                        firstUploadError = uploadError || { message: "Video upload failed" };
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
                logToFile(`❌ Upload creative exception: ${err.message}`);
                firstUploadError = err;
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

        // --- Step D: Retargeting AI Copywriting ---
        logToFile("--- 4. RETARGETING AI COPYWRITING ---");
        
        const visionInputs: string[] = [];
        
        if (inventoryIds.length > 0) {
             const { data: props } = await supabaseAdmin.from('properties').select('image_url').in('id', inventoryIds);
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
             const { data: asts } = await supabaseAdmin.from('assets').select('url').in('id', assetIds);
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
        const totalToGenerate = uploadedCreatives.length;

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
        
        let propertyTitle = "";
        if (inventoryIds.length > 0) {
            try {
                const { data: prop } = await supabaseAdmin
                    .from('properties')
                    .select('title')
                    .eq('id', inventoryIds[0])
                    .single();
                if (prop?.title) {
                    propertyTitle = prop.title;
                }
            } catch (e) {}
        }

        // Distinguishable Campaign Naming including Retargeting and Product Name
        const campaignName = `${businessName} - Retargeting (Retargetting) - ${propertyTitle || "AI Smart Campaign"} - ${new Date().toISOString().slice(0, 10)} - ${Date.now().toString().slice(-4)}`;

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
        let targetingConfig: any = { geo_locations: { countries: ['IN'], location_types: ['home'] } }; 
        
        if (metaLocationsStr) {
            try {
                const locationsArray = JSON.parse(metaLocationsStr);
                if (Array.isArray(locationsArray) && locationsArray.length > 0) {
                    targetingConfig = { 
                        geo_locations: { 
                            cities: [], 
                            regions: [], 
                            countries: [], 
                            zips: [], 
                            location_types: ['home'] 
                        } 
                    };
                    
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

                    const hasGranularTargeting = 
                        targetingConfig.geo_locations.cities.length > 0 ||
                        targetingConfig.geo_locations.regions.length > 0 ||
                        targetingConfig.geo_locations.zips.length > 0;

                    if (hasGranularTargeting) {
                        delete targetingConfig.geo_locations.countries;
                    } else if (targetingConfig.geo_locations.countries.length === 0) {
                        targetingConfig.geo_locations.countries.push('IN');
                    }

                    if (targetingConfig.geo_locations.cities.length === 0) delete targetingConfig.geo_locations.cities;
                    if (targetingConfig.geo_locations.regions.length === 0) delete targetingConfig.geo_locations.regions;
                    if (targetingConfig.geo_locations.zips.length === 0) delete targetingConfig.geo_locations.zips;
                }
            } catch (e) {
                console.error("Failed to parse locations array", e);
            }
        }

        // Apply smart targeting constraints and placements (matching high-performing campaigns)
        targetingConfig.age_min = ageMin !== undefined && ageMin !== null ? Math.min(ageMin, 25) : 18;
        if (ageMax !== undefined && ageMax !== null && ageMax < 65) {
            targetingConfig.age_max = ageMax;
        } else {
            delete targetingConfig.age_max;
        }
        targetingConfig.targeting_automation = { advantage_audience: 0 };
        targetingConfig.device_platforms = ['mobile', 'desktop'];
        targetingConfig.publisher_platforms = ['facebook', 'instagram']; // Exclude messenger for higher lead quality

        // --- Step F: Ad Set targeting custom audience ---
        logToFile("--- 6. AD SET ---");
        const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); 

        const customEventType = 'LEAD';

        const adSetPayload: any = {
            name: `Retargeting AdSet - CRM Qualified Leads`,
            campaign_id: campaignId,
            billing_event: 'IMPRESSIONS', 
            targeting: {
                ...targetingConfig,
                custom_audiences: targetCustomAudienceIds.map(id => ({ id }))
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

        const totalAdsToCreate = uploadedCreatives.length;
        
        for (let i = 0; i < totalAdsToCreate; i++) {
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
                name: `Retargeting Creative ${i + 1} - ${Date.now()}`,
                object_story_spec: {
                    page_id: pageId, 
                },
                access_token: facebookToken,
            };

            if (creativeItem.type === 'video') {
                const isWhatsAppRemarketing = campaignType === 'whatsapp_chat';
                const videoCtaType = isWhatsAppRemarketing ? 'WHATSAPP_MESSAGE' : 'LEARN_MORE';
                const videoCtaValue = isWhatsAppRemarketing ? { app_destination: 'WHATSAPP' } : ctaValue;

                creativePayload.object_story_spec.video_data = {
                    video_id: creativeItem.videoId,
                    message: copy.primary_text || "Welcome back! View our exclusive client details.",
                    title: copy.headline || "VIP Premium Access",
                    image_hash: globalThumbHash,
                    call_to_action: {
                        type: videoCtaType,
                        value: videoCtaValue
                    }
                };
            } else {
                creativePayload.object_story_spec.link_data = {
                    message: copy.primary_text || "Welcome back! View our exclusive client details.", 
                    name: copy.headline || "VIP Premium Access", 
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
                continue; 
            }

            try {
                const assetId = assetIds[i % assetIds.length];
                if (assetId) {
                    const fullCaption = `${copy.headline}\n\n${copy.primary_text}${copy.description ? `\n\n${copy.description}` : ''}`;
                    await supabaseAdmin.from('assets').update({ caption: fullCaption }).eq('id', assetId);
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

            let adRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/ads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(adPayload),
            });
            let adData = await adRes.json();

            if (!adRes.ok) {
                logToFile(`❌ Final Ad ${i+1} Failed with status ACTIVE, retrying with status PAUSED. Error details:`, adData);
                
                const pausedPayload = {
                    ...adPayload,
                    status: 'PAUSED'
                };
                const retryRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/ads`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pausedPayload),
                });
                const retryData = await retryRes.json();

                if (!retryRes.ok) {
                    logToFile(`❌ Final Ad ${i+1} Retry with status PAUSED also Failed:`, retryData);
                    if (adData.error?.error_subcode === 1359188 || adData.error?.code === 100) {
                        lastDraftError = true;
                    }
                } else {
                    logToFile(`Ad ${i + 1} Created successfully as PAUSED/Draft.`);
                    successfulAds++;
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
    } catch (outerErr: any) {
        logToFile("!!! OUTER API CRASH !!!", outerErr.message);
        return NextResponse.json(
            { error: outerErr.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
