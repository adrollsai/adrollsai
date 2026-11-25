import { META_GRAPH_URL } from '@/lib/ads/graph-version'
import { NextResponse, after } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { checkLimitAndIncrement, refundLimit } from '@/utils/subscription-server';
import { logToFile, clearLogFile } from '@/utils/logger';
import { ensureWabaSubscribed } from '@/utils/meta-subscription';
import { resolveCampaignPlan } from '@/lib/ads/campaign-plan';

export const maxDuration = 300;

export async function POST(request: Request) {
    clearLogFile();

    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let user = null;
    const mockUserHeader = request.headers.get('X-Mock-User');
    if (mockUserHeader && !process.env.VERCEL) {
        user = { id: mockUserHeader };
    } else {
        const clientSupabase = await createClient();
        const { data: { user: authUser } } = await clientSupabase.auth.getUser();
        user = authUser;
    }

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- 0. Resolve Target User ID ---
    const url = new URL(request.url);
    const impersonateId = url.searchParams.get('impersonate');
    const { data: ownProfile } = await supabaseAdmin.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
    let targetUserId = user.id;

    if (ownProfile?.role === 'agent' && (ownProfile?.parent_id || ownProfile?.agency_id)) {
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

    // --- SUBSCRIPTION CHECK ---
    try {
        await checkLimitAndIncrement(user.id, 'campaign_launches');
    } catch (limitErr: any) {
        return NextResponse.json({ error: limitErr.message }, { status: 403 });
    }

    // --- Parse Request Body ---
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
        // The goal the client picked, plus the conversion event for a conversions
        // campaign. Both are re-validated in lib/ads/campaign-plan before use.
        data.campaignGoal = formData.get('campaignGoal')?.toString() || undefined;
        data.conversionEvent = formData.get('conversionEvent')?.toString() || undefined;
        // The modal has always sent a gender; the route never read it, so it was dropped.
        data.gender = formData.get('gender')?.toString() || undefined;
        data.inventoryIds = formData.getAll('inventoryIds').map(String);
        data.assetIds = formData.getAll('assetIds').map(String);
        data.creativeUrls = formData.getAll('creativeUrls').map(String);
        data.creativeProductIds = formData.getAll('creativeProductIds').map(String);
        data.campaignType = formData.get('campaignType')?.toString();
        data.pixelId = formData.get('pixelId')?.toString();
        data.adCopyJson = formData.get('adCopy')?.toString();
        data.adCopiesJson = formData.get('adCopies')?.toString();
        data.whatsappNumber = formData.get('whatsappNumber')?.toString();
        data.customInstructions = formData.get('customInstructions')?.toString();
        data.campaign_name = formData.get('campaign_name')?.toString() || formData.get('campaignName')?.toString();
        data.adset_name = formData.get('adset_name')?.toString() || formData.get('adsetName')?.toString();

        data.detailedTargeting = formData.get('detailedTargeting')?.toString();
        data.leadFormConfig = formData.get('leadFormConfig')?.toString();
        data.existingLeadFormId = formData.get('existingLeadFormId')?.toString();
        data.droppedPins = formData.get('droppedPins')?.toString();

        const ageMinVal = formData.get('ageMin');
        if (ageMinVal) data.ageMin = parseInt(ageMinVal.toString());
        const ageMaxVal = formData.get('ageMax');
        if (ageMaxVal) data.ageMax = parseInt(ageMaxVal.toString());

        const audStr = formData.get('customAudienceIds')?.toString();
        if (audStr) {
            try { data.customAudienceIds = JSON.parse(audStr); } catch (e) {}
        }
    }

    // --- Resolve profile data ---
    const { data: targetProfileData } = await supabaseAdmin.from('profiles')
        .select('facebook_token, ad_account_id, selected_page_id, selected_page_token, custom_domain, business_name, contact_number, currency, pixel_id, logo_url, business_info, mission_statement, industry, whatsapp_waba_id, whatsapp_access_token, whatsapp_phone_number')
        .eq('id', targetUserId)
        .single();
    const targetProfile: any = targetProfileData;

    if (targetProfile) {
        data.facebookToken = data.facebookToken || targetProfile.facebook_token;
        data.adAccountId = data.adAccountId || targetProfile.ad_account_id;
        data.pageId = data.pageId || targetProfile.selected_page_id;
        if (!data.pageId && targetProfile.business_info) {
            try {
                const bi = typeof targetProfile.business_info === 'string' ? JSON.parse(targetProfile.business_info) : targetProfile.business_info;
                if (Array.isArray(bi?.selected_pages) && bi.selected_pages.length > 0 && bi.selected_pages[0]?.id) {
                    data.pageId = bi.selected_pages[0].id;
                }
            } catch (e) {}
        }
        const targetBusinessUrl = targetProfile.custom_domain
            ? `https://${targetProfile.custom_domain}`
            : `https://app.nobogent.com/shared/${targetUserId}`;
        data.linkUrl = data.linkUrl || targetBusinessUrl;
        data.privacyPolicyUrl = data.privacyPolicyUrl || `${targetBusinessUrl}/privacy`;
        data.business_name = targetProfile.business_name;
        data.contact_number = targetProfile.contact_number;
        data.whatsappNumber = data.whatsappNumber || targetProfile.whatsapp_phone_number || '';
    }

    const {
        facebookToken, adAccountId, pageId, linkUrl, privacyPolicyUrl,
        dailyBudget = 500, metaLocations: metaLocationsStr,
        optimizeForConversions, customQuestions: customQuestionsStr,
        campaignGoal, conversionEvent, gender,
        inventoryIds = [], assetIds = [],
        campaignType = 'instant_form', pixelId,
        ageMin, ageMax, customAudienceIds = []
    } = data;

    const currency = targetProfile?.currency || 'INR';
    const finalPixelId = pixelId || targetProfile?.pixel_id || null;

    // Resolve the goal once, here, and let the plan decide the destination the job
    // carries. A stale modal, a replayed payload or a hand-made API call can then never
    // ask for a combination Meta would reject (a lead form on an engagement campaign,
    // a conversions campaign with no pixel, ...).
    const plan = resolveCampaignPlan({
        campaignType,
        campaignGoal,
        conversionEvent,
        optimizeForConversions,
    });
    const effectiveCampaignType: 'instant_form' | 'website_conversion' | 'whatsapp_chat' =
        plan.goal === 'whatsapp'
            ? 'whatsapp_chat'
            : plan.goal === 'conversions'
                ? 'website_conversion'
                : 'instant_form';

    // --- VALIDATIONS ---
    if (plan.requiresPixel && !finalPixelId) {
        await refundLimit(user.id, 'campaign_launches');
        return NextResponse.json(
            { error: 'A Meta Pixel / Dataset is required for a conversions campaign. Pick a pixel, or switch the goal to Leads.' },
            { status: 400 }
        );
    }

    if (plan.requiresWhatsAppNumber && !String(data.whatsappNumber || '').replace(/\D/g, '')) {
        await refundLimit(user.id, 'campaign_launches');
        return NextResponse.json(
            { error: 'A connected WhatsApp number is required for a WhatsApp campaign.' },
            { status: 400 }
        );
    }

    if (!facebookToken || !adAccountId || !pageId) {
        await refundLimit(user.id, 'campaign_launches');
        const missing = [];
        if (!facebookToken) missing.push("Facebook Access Token");
        if (!adAccountId) missing.push("Ad Account ID");
        if (!pageId) missing.push("Facebook Page ID");
        return NextResponse.json(
            { error: `Meta Ads account not fully connected. Missing: ${missing.join(', ')}.` },
            { status: 400 }
        );
    }

    // Is the Meta connection still alive? A dead token used to surface as a generic
    // "Campaign Error: Invalid parameter" after the launch had already been counted,
    // which tells the client nothing. Ask first, and answer in those words.
    {
        const { diagnoseConnection } = await import('@/lib/ads/token-health');
        const { META_GRAPH_URL } = await import('@/lib/ads/graph-version');
        try {
            const probeRes = await fetch(
                `${META_GRAPH_URL}/${adAccountId}?fields=id,name,account_status&access_token=${facebookToken}`,
                { cache: 'no-store' }
            );
            const probeJson: any = await probeRes.json().catch(() => ({}));
            const probeErr = probeJson?.error;
            const health = diagnoseConnection(
                probeErr
                    ? {
                          ok: false,
                          code: probeErr.code,
                          subcode: probeErr.error_subcode,
                          message: probeErr.error_user_msg || probeErr.message,
                          httpStatus: probeRes.status,
                      }
                    : { ok: true, accountStatus: Number(probeJson?.account_status) }
            );
            if (health.needsAction) {
                await refundLimit(user.id, 'campaign_launches');
                return NextResponse.json(
                    { error: `${health.title.replace(/^⚠️\s*/, '')}. ${health.body}`, code: health.verdict },
                    { status: 400 }
                );
            }
        } catch {
            // A probe that cannot complete must not block a launch; the campaign
            // pre-flight and the real call will report the truth.
        }
    }

    // Guarantee Page is subscribed to Meta webhooks for real-time lead ingestion
    fetch(`${META_GRAPH_URL}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${facebookToken}`, {
        method: 'POST'
    }).catch(() => {});

    // Guarantee WABA is subscribed to Meta webhooks for real-time WhatsApp chat/lead ingestion
    if (targetProfile?.whatsapp_waba_id) {
        ensureWabaSubscribed(targetProfile.whatsapp_waba_id, targetProfile.whatsapp_access_token).catch(() => {});
    }

    const hasCreatives = (data.creativeUrls && data.creativeUrls.length > 0) || inventoryIds.length > 0 || assetIds.length > 0;
    if (!hasCreatives) {
        await refundLimit(user.id, 'campaign_launches');
        return NextResponse.json(
            { error: 'No creatives selected. Please select or upload at least one creative.' },
            { status: 400 }
        );
    }

    // --- Parse pre-generated ad copy ---
    let adCopy = { primary_text: '', headline: '', description: '' };
    let adCopies = [];
    try {
        if (data.adCopyJson) {
            adCopy = JSON.parse(data.adCopyJson);
        } else if (data.adCopy && typeof data.adCopy === 'object') {
            adCopy = data.adCopy;
        }
    } catch (e) { /* ignore parse errors */ }

    try {
        if (data.adCopiesJson) {
            adCopies = JSON.parse(data.adCopiesJson);
        } else if (data.adCopies && Array.isArray(data.adCopies)) {
            adCopies = data.adCopies;
        }
    } catch (e) { /* ignore parse errors */ }

    // Fallback: check if selected asset has a caption in DB
    let fetchedCaption = "";
    if ((!adCopy.headline || !adCopy.primary_text) && assetIds && assetIds.length > 0) {
        try {
            const { data: asset } = await supabaseAdmin.from('assets').select('caption').eq('id', assetIds[0]).single();
            if (asset?.caption) {
                fetchedCaption = asset.caption;
            }
        } catch (e) {}
    }

    if (fetchedCaption && (!adCopy.headline || !adCopy.primary_text)) {
        try {
            const parsed = JSON.parse(fetchedCaption);
            if (parsed.headline) adCopy.headline = parsed.headline;
            if (parsed.primary_text) adCopy.primary_text = parsed.primary_text;
            if (parsed.social_post_description) adCopy.description = parsed.social_post_description;
            else if (parsed.description) adCopy.description = parsed.description;
        } catch (e) {
            const lines = fetchedCaption.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length > 0) {
                adCopy.headline = lines[0].substring(0, 40);
                adCopy.primary_text = lines.slice(1).join('\n').substring(0, 400) || lines[0];
                adCopy.description = 'View details and pricing now.';
            }
        }
    }

    // Fallback: if no copy, generate using LLM (Gemini)
    if (!adCopy.headline || !adCopy.primary_text) {
        let propertyContext = "";
        if (inventoryIds && inventoryIds.length > 0) {
            try {
                const { data: prop } = await supabaseAdmin.from('properties').select('title, description').eq('id', inventoryIds[0]).single();
                if (prop) {
                    propertyContext = `Product Title: ${prop.title || ''}\nProduct Description: ${prop.description || ''}`;
                }
            } catch (e) {}
        }

        const businessName = data.business_name || targetProfile?.business_name || 'Our Business';
        const contactNumber = data.contact_number || targetProfile?.contact_number || '';
        const businessInfo = targetProfile?.business_info || targetProfile?.bio || '';
        const missionStatement = targetProfile?.mission_statement || '';

        const contextDetails = [
            `Business Name: ${businessName}`,
            contactNumber ? `Contact: ${contactNumber}` : '',
            businessInfo ? `Business Info: ${businessInfo}` : '',
            missionStatement ? `Mission Statement: ${missionStatement}` : '',
            propertyContext ? propertyContext : ''
        ].filter(Boolean).join('\n');

        const customInstructionNotice = data.customInstructions 
            ? `Custom Copywriting Prompt / Instructions (MUST FOLLOW STRICTLY):\n"${data.customInstructions}"`
            : `Note: No custom prompt was provided. Craft high-converting ad copy highlighting the business strengths, services, or offer.`;

        const llmPrompt = `You are an elite direct-response ad copywriter. Write a high-converting ad copy for:
${contextDetails}

${customInstructionNotice}

You must write exactly three fields:
1. headline (maximum 40 characters) - a catchy, strong hook. Do NOT use markdown.
2. primary_text (maximum 150 characters) - a compelling, clear direct-response message calling out the buyer. Do NOT use markdown or hashtags.
3. description (maximum 400 characters) - a description or offer benefits. Must be under 400 characters.

Output ONLY a raw JSON object matching this structure (no markdown wrappers like \`\`\`json):
{
  "headline": "...",
  "primary_text": "...",
  "description": "..."
}`;

        try {
            const { generateKieChat } = await import('@/utils/external-apis');
            const responseText = await generateKieChat(llmPrompt, "gemini-3-flash-preview");
            const cleanText = responseText.replace(/```json/i, '').replace(/```/g, '').trim();
            const parsedCopy = JSON.parse(cleanText);
            
            if (parsedCopy.headline) adCopy.headline = parsedCopy.headline;
            if (parsedCopy.primary_text) adCopy.primary_text = parsedCopy.primary_text;
            if (parsedCopy.description) adCopy.description = parsedCopy.description;
        } catch (llmErr) {
            console.error("[Launch Campaign] LLM ad copy generation failed, using fallback:", llmErr);
            // Fallback to static text parsing
            if (inventoryIds.length > 0) {
                try {
                    const { data: prop } = await supabaseAdmin.from('properties').select('title, description').eq('id', inventoryIds[0]).single();
                    if (prop) {
                        adCopy.headline = (prop.title || 'View Details').substring(0, 40);
                        adCopy.primary_text = (prop.description || 'Exclusive deal. Contact us for details.').substring(0, 400);
                        adCopy.description = 'View pricing & details. Contact us today.';
                    }
                } catch (e) {}
            } else if (businessName) {
                adCopy.headline = `Connect with ${businessName}`.substring(0, 40);
                adCopy.primary_text = `Discover exclusive services and consultations with ${businessName}. Contact us today!`;
                adCopy.description = 'Contact us today.';
            }
        }
    }

    // Final fallback
    if (!adCopy.headline) adCopy.headline = 'View Details';
    if (!adCopy.primary_text) adCopy.primary_text = 'Exclusive deal. View pricing & details now.';
    if (!adCopy.description) adCopy.description = 'Contact us today.';

    logToFile("=== CREATING CAMPAIGN JOB ===", { userId: user.id, targetUserId });

    // --- CREATE JOB ---
    const jobPayload = {
        facebookToken,
        adAccountId,
        pageId,
        linkUrl,
        privacyPolicyUrl,
        dailyBudget,
        metaLocationsStr,
        optimizeForConversions,
        customQuestionsStr,
        campaignGoal,
        conversionEvent,
        gender,
        inventoryIds,
        assetIds,
        creativeUrls: data.creativeUrls || [],
        campaignType: effectiveCampaignType,
        pixelId: finalPixelId,
        ageMin,
        ageMax,
        customAudienceIds,
        adCopy,
        adCopies,
        creativeProductIds: data.creativeProductIds || [],
        whatsappNumber: data.whatsappNumber || targetProfile?.whatsapp_phone_number || "",
        businessName: data.business_name || targetProfile?.business_name || "Our Business",
        contactNumber: (effectiveCampaignType === 'whatsapp_chat' ? (data.whatsappNumber || targetProfile?.whatsapp_phone_number) : null) || data.contact_number || targetProfile?.contact_number || "",
        businessInfo: targetProfile?.business_info || targetProfile?.bio || "",
        missionStatement: targetProfile?.mission_statement || "",
        // The vertical decides the legally required special ad category (HOUSING for
        // property ads, EMPLOYMENT for job ads, ...). It has to travel with the job
        // because the Advantage+ plan is resolved there, and a category that is not
        // declared is both a compliance problem and a publish failure later on.
        industry: (targetProfile as any)?.industry || null,
        specialAdCategories: (data as any).specialAdCategories ?? (data as any).specialAdCategory ?? null,
        advantageAudience: (data as any).advantageAudience ?? null,
        advantagePlacements: (data as any).advantagePlacements ?? null,
        currency,
        logoUrl: targetProfile?.logo_url || null,
        customInstructions: data.customInstructions || null,
        campaign_name: data.campaign_name || null,
        adset_name: data.adset_name || null,
        targetUserId,
        selected_page_token: targetProfile?.selected_page_token || null,
        interests: (() => {
            if (!data.detailedTargeting) return [];
            try { return typeof data.detailedTargeting === 'string' ? JSON.parse(data.detailedTargeting) : data.detailedTargeting; } catch (e) { return []; }
        })(),
        leadFormConfig: (() => {
            if (!data.leadFormConfig) return null;
            try { return typeof data.leadFormConfig === 'string' ? JSON.parse(data.leadFormConfig) : data.leadFormConfig; } catch (e) { return null; }
        })(),
        existingLeadFormId: data.existingLeadFormId || null,
        droppedPins: (() => {
            if (!data.droppedPins) return [];
            try { return typeof data.droppedPins === 'string' ? JSON.parse(data.droppedPins) : data.droppedPins; } catch (e) { return []; }
        })()
    };

    let jobId = null;
    let fallbackWarning = "";
    /** True when the job id could not be persisted, so it cannot be polled. */
    let untracked = false;

    // --- DOUBLE-LAUNCH GUARD ---
    //
    // A second click, a browser retry, or an impatient press while the first response
    // was still pending used to create a whole second campaign — second budget, second
    // draw on the launch credits. The fingerprint covers only what makes two launches
    // the same campaign; change the budget, the creative or the locations and it is
    // deliberately a different launch.
    const { launchFingerprint, findDuplicateLaunch, duplicateLaunchMessage } = await import('@/lib/ads/launch-idempotency');
    const fingerprint = launchFingerprint({
        targetUserId,
        campaignName: jobPayload.campaign_name || data.campaign_name || data.campaignName || null,
        campaignType: effectiveCampaignType,
        campaignGoal: plan.goal,
        conversionEvent: plan.conversionEvent,
        dailyBudget,
        pageId,
        adAccountId,
        pixelId: finalPixelId,
        creativeKeys: [
            ...(jobPayload.creativeUrls || []),
            ...(jobPayload.assetIds || []),
            ...(jobPayload.inventoryIds || []),
        ].map(String),
        locations: jobPayload.metaLocationsStr || jobPayload.droppedPins || null,
    });

    let duplicateJobId: string | null = null;
    try {
        const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { data: recentJobs } = await supabaseAdmin
            .from('campaign_jobs')
            .select('id, payload, created_at, status')
            .eq('user_id', user.id)
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(20);
        const previous = (recentJobs || []).map((row: any) => ({
            jobId: row.id,
            fingerprint: String(row.payload?._fingerprint || ''),
            createdAt: row.created_at,
            status: row.status,
        }));
        const duplicate = findDuplicateLaunch(fingerprint, previous);
        if (duplicate) duplicateJobId = duplicate.jobId;
    } catch (e) {
        // A guard that cannot read history must not block a legitimate launch.
    }

    if (duplicateJobId) {
        await refundLimit(user.id, 'campaign_launches');
        logToFile(`[LaunchCampaign] Duplicate launch suppressed; existing job ${duplicateJobId}`);
        return NextResponse.json({
            success: true,
            duplicate: true,
            jobId: duplicateJobId,
            message: duplicateLaunchMessage(duplicateJobId),
        });
    }

    (jobPayload as any)._fingerprint = fingerprint;

    const { data: job, error: jobErr } = await supabaseAdmin.from('campaign_jobs').insert({
        user_id: user.id,
        target_user_id: targetUserId,
        status: 'pending',
        payload: jobPayload
    }).select('id').single();

    if (jobErr || !job) {
        logToFile("campaign_jobs DB insert failed (normal if migration sql hasn't been run yet):", jobErr?.message || "unknown");
        // Fallback: Generate a random job ID locally so campaign still launches
        const crypto = require('crypto');
        jobId = crypto.randomUUID();
        untracked = true;
        fallbackWarning = "Live progress tracking is unavailable on this deployment (campaign_jobs could not be written).";
    } else {
        jobId = job.id;
        logToFile(`Job created in DB: ${jobId}`);
    }

    // --- ASYNCHRONOUS BACKGROUND EXECUTION VIA AFTER() ---
    logToFile(`[LaunchCampaign] Scheduling async background runCampaignJob for jobId: ${jobId}`);
    
    after(async () => {
        try {
            const { runCampaignJob } = await import('@/utils/campaign-processor');
            await runCampaignJob(jobId, jobPayload);
        } catch (err: any) {
            logToFile(`[LaunchCampaign] Background processor error: ${err.message}`);
        }
    });

    return NextResponse.json({
        success: true,
        jobId: jobId,
        /**
         * The client must know whether this id is pollable.
         *
         * When the `campaign_jobs` insert fails we still launch, but with a locally
         * invented uuid — which `/api/meta-ads/campaign-job-status` can only answer with
         * `unknown`. The UI then told the user "Could not confirm the campaign launch"
         * about a campaign that had in fact been created. `untracked` lets it say
         * "check Ads Manager" instead of pretending the launch failed.
         */
        untracked: untracked || undefined,
        warning: fallbackWarning || undefined,
        message: untracked
            ? 'Launch started. Live progress tracking is unavailable right now — check Meta Ads Manager in a couple of minutes to see the result.'
            : 'Campaign is being launched in the background. You will be notified when it\'s ready.'
    });
}