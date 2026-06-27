import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { checkLimitAndIncrement, refundLimit } from '@/utils/subscription-server';
import { logToFile, clearLogFile } from '@/utils/logger';

// This route is now FAST — it only validates and creates a job.
// No need for long maxDuration since heavy work is done by process-campaign-job.
export const maxDuration = 30;

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
        data.inventoryIds = formData.getAll('inventoryIds').map(String);
        data.assetIds = formData.getAll('assetIds').map(String);
        data.campaignType = formData.get('campaignType')?.toString();
        data.pixelId = formData.get('pixelId')?.toString();
        data.adCopyJson = formData.get('adCopy')?.toString();

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
            : `https://app.adrolls.in/shared/${targetUserId}`;
        data.linkUrl = data.linkUrl || targetBusinessUrl;
        data.privacyPolicyUrl = data.privacyPolicyUrl || `${targetBusinessUrl}/privacy`;
        data.business_name = targetProfile.business_name;
        data.contact_number = targetProfile.contact_number;
    }

    const {
        facebookToken, adAccountId, pageId, linkUrl, privacyPolicyUrl,
        dailyBudget = 500, metaLocations: metaLocationsStr,
        optimizeForConversions, customQuestions: customQuestionsStr,
        inventoryIds = [], assetIds = [],
        campaignType = 'instant_form', pixelId,
        ageMin, ageMax, customAudienceIds = []
    } = data;

    const currency = targetProfile?.currency || 'INR';
    const isWebsiteCampaign = campaignType === 'website_conversion';
    const finalPixelId = pixelId || targetProfile?.pixel_id || null;

    // --- VALIDATIONS ---
    if (isWebsiteCampaign && !finalPixelId) {
        await refundLimit(user.id, 'campaign_launches');
        return NextResponse.json(
            { error: 'Meta Pixel ID is required for Website Conversion campaigns.' },
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

    if (inventoryIds.length === 0 && assetIds.length === 0) {
        await refundLimit(user.id, 'campaign_launches');
        return NextResponse.json(
            { error: 'No creatives selected. Please select at least one product or asset.' },
            { status: 400 }
        );
    }

    // --- Parse pre-generated ad copy ---
    let adCopy = { primary_text: '', headline: '', description: '' };
    try {
        if (data.adCopyJson) {
            adCopy = JSON.parse(data.adCopyJson);
        } else if (data.adCopy && typeof data.adCopy === 'object') {
            adCopy = data.adCopy;
        }
    } catch (e) { /* ignore parse errors */ }

    // Fallback: if no ad copy provided, generate from inventory
    if (!adCopy.headline && inventoryIds.length > 0) {
        const { data: prop } = await supabaseAdmin.from('properties').select('title, description').eq('id', inventoryIds[0]).single();
        if (prop) {
            adCopy.headline = (prop.title || 'View Details').substring(0, 40);
            adCopy.primary_text = (prop.description || 'Exclusive deal. Contact us for details.').substring(0, 400);
            adCopy.description = 'View pricing & details. Contact us today.';
            if (data.contact_number) adCopy.primary_text += `\n\n📞 ${data.contact_number}`;
            if (data.business_name) adCopy.primary_text += `\n🏢 ${data.business_name}`;
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
        inventoryIds,
        assetIds,
        campaignType,
        pixelId: finalPixelId,
        ageMin,
        ageMax,
        customAudienceIds,
        adCopy,
        businessName: data.business_name || "Our Business",
        contactNumber: data.contact_number || "",
        currency,
        logoUrl: targetProfile?.logo_url || null
    };

    let jobId = null;
    let fallbackWarning = "";

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
        fallbackWarning = "Note: Background status tracking is inactive because campaign_jobs table has not been created.";
        
        // Write status locally
        try {
            const { writeJobLocal } = require('@/utils/job-store');
            writeJobLocal(jobId, {
                status: 'pending',
                payload: jobPayload,
                user_id: user.id,
                target_user_id: targetUserId
            });
        } catch (e: any) {
            logToFile("Failed to save local job store:", e.message);
        }
    } else {
        jobId = job.id;
        logToFile(`Job created in DB: ${jobId}`);
    }

    // --- FIRE-AND-FORGET: Trigger the background processor ---
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const processUrl = `${protocol}://${host}/api/meta-ads/process-campaign-job`;

    // Fire and forget — we don't await this
    fetch(processUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, payload: jobPayload })
    }).catch(err => {
        logToFile("Failed to trigger job processor:", err.message);
    });

    // --- RETURN IMMEDIATELY ---
    return NextResponse.json({
        success: true,
        jobId: jobId,
        warning: fallbackWarning || undefined,
        message: 'Campaign is being launched in the background. You will be notified when it\'s ready.'
    });
}