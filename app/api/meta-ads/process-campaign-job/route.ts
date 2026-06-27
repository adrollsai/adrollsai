import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logToFile } from '@/utils/logger';

// This endpoint does the heavy Meta API work — runs long, doesn't face user-timeout
export const maxDuration = 300;

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    let jobId: string | null = null;
    let job: any = null;

    try {
        const body = await request.json();
        jobId = body.jobId;

        if (!jobId) {
            return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
        }

        // 1. Fetch the job from DB or fallback to request payload
        let payload = null;

        try {
            const { data, error: jobErr } = await supabaseAdmin
                .from('campaign_jobs')
                .select('*')
                .eq('id', jobId)
                .single();
            if (!jobErr && data) {
                job = data;
                payload = job.payload;
            }
        } catch (dbErr: any) {
            logToFile("[Processor] campaign_jobs query failed (normal if table doesn't exist):", dbErr.message);
        }

        if (!payload && body.payload) {
            payload = body.payload;
            logToFile("[Processor] Using payload from request body");
        }

        if (!payload) {
            return NextResponse.json({ error: 'Job payload not found' }, { status: 404 });
        }

        if (job && job.status !== 'pending') {
            return NextResponse.json({ error: 'Job already processed', status: job.status });
        }

        // 2. Mark as processing
        if (job) {
            await supabaseAdmin.from('campaign_jobs').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', jobId);
        }
        const {
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
            pixelId,
            ageMin,
            ageMax,
            customAudienceIds,
            adCopy,
            businessName,
            contactNumber,
            currency,
            logoUrl
        } = payload;

        const isWebsiteCampaign = campaignType === 'website_conversion';
        const finalPixelId = pixelId || null;

        logToFile("=== [JOB PROCESSOR] STARTING CAMPAIGN CREATION ===", { jobId });

        // --- Step 1: Build Creative Items ---
        interface CreativeItem {
            type: 'image' | 'video';
            url?: string;
        }
        const creativeItems: CreativeItem[] = [];

        // 1. First, build creative items from assetIds (explicitly selected assets)
        if (assetIds && assetIds.length > 0) {
            const { data: assets } = await supabaseAdmin
                .from('assets')
                .select('url, type')
                .in('id', assetIds);
            if (assets) {
                assets.forEach((asset: any) => {
                    if (asset.url) {
                        const isVideo = asset.type === 'video' || asset.url.toLowerCase().match(/\.(mp4|mov|avi|wmv)$/);
                        creativeItems.push({ type: isVideo ? 'video' : 'image', url: asset.url });
                    }
                });
            }
        }

        // 2. Only fall back to inventoryIds (product images) if no specific assets were selected
        if (creativeItems.length === 0 && inventoryIds && inventoryIds.length > 0) {
            const { data: props } = await supabaseAdmin
                .from('properties')
                .select('title, description, images, image_url')
                .in('id', inventoryIds);
            if (props) {
                props.forEach((prop: any) => {
                    if (prop.images && Array.isArray(prop.images) && prop.images.length > 0) {
                        prop.images.forEach((img: string) => {
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

        if (creativeItems.length === 0) {
            throw new Error("No images or videos found in the selected properties or assets.");
        }

        // --- Step 2: Upload Creatives to Meta ---
        logToFile("--- UPLOADING CREATIVES TO META ---");
        interface UploadedCreative {
            type: 'image' | 'video';
            hash?: string;
            videoId?: string;
        }
        const uploadedCreatives: UploadedCreative[] = [];
        let globalThumbHash: string | null = null;

        // Prepare thumbnail if videos exist
        const hasVideos = creativeItems.some(item => item.type === 'video');
        if (hasVideos) {
            let thumbSource = logoUrl || 'https://placehold.co/600x600.png';
            try {
                let thumbFetch = await fetch(thumbSource);
                if (!thumbFetch.ok && thumbSource !== 'https://placehold.co/600x600.png') {
                    logToFile(`Failed to download custom logo (${thumbFetch.statusText}), falling back to placeholder`);
                    thumbSource = 'https://placehold.co/600x600.png';
                    thumbFetch = await fetch(thumbSource);
                }
                if (thumbFetch.ok) {
                    const thumbBlob = await thumbFetch.blob();
                    const thumbData = new FormData();
                    thumbData.append('source', thumbBlob, `thumb_${Date.now()}.png`);
                    thumbData.append('access_token', facebookToken);
                    const thumbRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, { method: 'POST', body: thumbData });
                    const thumbResult = await thumbRes.json();
                    if (thumbResult.images) {
                        globalThumbHash = thumbResult.images[Object.keys(thumbResult.images)[0]].hash;
                        logToFile(`Successfully uploaded thumbnail to Meta. Hash: ${globalThumbHash}`);
                    } else {
                        logToFile("Meta thumbnail upload response missing images:", thumbResult);
                    }
                } else {
                    logToFile(`Failed to download fallback placeholder image: ${thumbFetch.statusText}`);
                }
            } catch (e: any) {
                logToFile("Failed to prepare thumbnail:", e.message);
            }
        }

        let firstUploadError: any = null;
        for (let i = 0; i < creativeItems.length; i++) {
            const item = creativeItems[i];
            try {
                if (item.type === 'video') {
                    const videoData = new FormData();
                    if (item.url) {
                        logToFile(`Downloading video for binary upload: ${item.url}`);
                        const videoFetch = await fetch(item.url);
                        if (!videoFetch.ok) {
                            throw new Error(`Failed to fetch video file from storage: ${videoFetch.statusText}`);
                        }
                        const videoBlob = await videoFetch.blob();
                        videoData.append('source', videoBlob, 'video.mp4');
                    }
                    videoData.append('access_token', facebookToken);
                    const videoRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/advideos`, { method: 'POST', body: videoData });
                    const videoResult = await videoRes.json();
                    if (videoResult.id) {
                        uploadedCreatives.push({ type: 'video', videoId: videoResult.id });
                    } else {
                        firstUploadError = videoResult.error || { message: "Video upload failed" };
                    }
                } else {
                    const imgData = new FormData();
                    if (item.url) {
                        const imgFetch = await fetch(item.url);
                        if (!imgFetch.ok) continue;
                        const imgBlob = await imgFetch.blob();
                        imgData.append('source', imgBlob, 'image.png');
                    }
                    imgData.append('access_token', facebookToken);
                    const imgRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, { method: 'POST', body: imgData });
                    const imgResult = await imgRes.json();
                    if (imgResult.images) {
                        const hash = imgResult.images[Object.keys(imgResult.images)[0]].hash;
                        uploadedCreatives.push({ type: 'image', hash });
                        if (!globalThumbHash) globalThumbHash = hash;
                    } else {
                        firstUploadError = imgResult.error || { message: "Image upload failed" };
                    }
                }
            } catch (err: any) {
                firstUploadError = { message: err.message };
            }
        }

        if (uploadedCreatives.length === 0) {
            const msg = firstUploadError?.message || "Could not upload any creatives to Facebook.";
            throw new Error(`Creative upload failed: ${msg}`);
        }

        if (uploadedCreatives.some(c => c.type === 'video')) {
            logToFile("Waiting 5 seconds for Meta to process uploaded videos...");
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        logToFile(`Uploaded ${uploadedCreatives.length} creatives to Meta.`);

        // --- Step 3: Use Pre-Generated Ad Copy ---
        const copyVariations = [];
        for (let i = 0; i < uploadedCreatives.length; i++) {
            copyVariations.push({
                primary_text: adCopy?.primary_text || "View pricing & details now.",
                headline: adCopy?.headline || "View Details",
                description: adCopy?.description || "Contact us today."
            });
        }

        // --- Step 4: Create Lead Form ---
        let leadFormId = null;
        if (!isWebsiteCampaign) {
            logToFile("--- CREATING LEAD FORM ---");

            let metaCustomQuestions: any[] = [];
            if (customQuestionsStr && customQuestionsStr !== "[]") {
                try {
                    const parsedQuestions = JSON.parse(customQuestionsStr);
                    metaCustomQuestions = parsedQuestions.map((q: any) => {
                        const label = q.label.trim();
                        const lowerLabel = label.toLowerCase();
                        
                        if (q.type !== 'MULTIPLE_CHOICE') {
                            if (lowerLabel.includes('company') || lowerLabel.includes('business name')) return { type: 'COMPANY_NAME', key: 'company_name' };
                            if (lowerLabel.includes('job title') || lowerLabel.includes('designation')) return { type: 'JOB_TITLE', key: 'job_title' };
                            if (lowerLabel.includes('city')) return { type: 'CITY', key: 'city' };
                            if (lowerLabel.includes('state')) return { type: 'STATE', key: 'state' };
                        }

                        const metaQ: any = { type: 'CUSTOM', label: label.substring(0, 200) };
                        if (q.type === 'MULTIPLE_CHOICE' && Array.isArray(q.options)) {
                            const validOptions = q.options
                                .filter((o: string) => o.trim() !== '')
                                .map((opt: string) => ({ value: opt.trim(), key: opt.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50) }));
                            if (validOptions.length > 0) metaQ.options = validOptions;
                        }
                        return metaQ;
                    });

                    const seenTypes = new Set(['FULL_NAME', 'EMAIL', 'PHONE']);
                    metaCustomQuestions = metaCustomQuestions.filter((q: any) => {
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
            const questionLabels = metaCustomQuestions.map((q: any) => q.label || q.type).filter(Boolean).map((label: string) => label.replace(/[?:]/g, '').trim()).join(', ');
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

            const formCreateRes = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(leadFormPayload)
            });
            const formCreateData = await formCreateRes.json();

            if (!formCreateRes.ok) {
                logToFile("Lead Form Creation Failed:", formCreateData);
                throw new Error(`Meta Lead Form Error: ${formCreateData.error?.error_user_msg || formCreateData.error?.message || "Unknown Error"}`);
            }
            leadFormId = formCreateData.id;
            logToFile(`Lead Form Created: ${leadFormId}`);
        }

        // --- Step 5: Create Campaign ---
        logToFile("--- CREATING CAMPAIGN ---");
        let propertyTitle = "";
        if (inventoryIds && inventoryIds.length > 0) {
            const { data: prop } = await supabaseAdmin.from('properties').select('title').eq('id', inventoryIds[0]).single();
            if (prop?.title) propertyTitle = prop.title;
        }

        const campaignName = `${businessName} - ${customAudienceIds?.length > 0 ? 'Retargeting' : (propertyTitle || "AI Smart Campaign")} - ${new Date().toISOString().slice(0, 10)} - ${Date.now().toString().slice(-4)}`;

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
            const metaErr = campaignData.error;
            throw new Error(`Campaign Error: ${metaErr?.error_user_msg || metaErr?.message || "Invalid parameter"}`);
        }
        const campaignId = campaignData.id;

        // --- Step 6: Parse Targeting ---
        let targetingConfig: any = { geo_locations: { countries: ['IN'], location_types: ['home'] } };
        if (metaLocationsStr) {
            try {
                const locationsArray = JSON.parse(metaLocationsStr);
                if (Array.isArray(locationsArray) && locationsArray.length > 0) {
                    targetingConfig = { geo_locations: { cities: [], regions: [], countries: [], zips: [], location_types: ['home'] } };
                    locationsArray.forEach((locData: any) => {
                        const loc = locData.location;
                        if (loc && loc.key) {
                            if (loc.type === 'city') targetingConfig.geo_locations.cities.push({ key: loc.key, radius: locData.radius || 20, distance_unit: 'kilometer' });
                            else if (loc.type === 'region') targetingConfig.geo_locations.regions.push({ key: loc.key });
                            else if (loc.type === 'country') targetingConfig.geo_locations.countries.push(loc.country_code || loc.key);
                            else if (loc.type === 'zip') targetingConfig.geo_locations.zips.push({ key: loc.key });
                        }
                    });

                    const hasGranular = targetingConfig.geo_locations.cities.length > 0 || targetingConfig.geo_locations.regions.length > 0 || targetingConfig.geo_locations.zips.length > 0;
                    if (hasGranular && targetingConfig.geo_locations.countries.length === 0) delete targetingConfig.geo_locations.countries;
                    else if (targetingConfig.geo_locations.countries.length === 0) targetingConfig.geo_locations.countries.push('IN');

                    if (targetingConfig.geo_locations.cities.length === 0) delete targetingConfig.geo_locations.cities;
                    if (targetingConfig.geo_locations.regions.length === 0) delete targetingConfig.geo_locations.regions;
                    if (targetingConfig.geo_locations.zips.length === 0) delete targetingConfig.geo_locations.zips;
                }
            } catch (e) {
                logToFile("Failed to parse locations", e);
            }
        }

        targetingConfig.age_min = ageMin !== undefined && ageMin !== null ? Math.min(ageMin, 25) : 18;
        targetingConfig.age_max = 65;
        targetingConfig.targeting_relaxation_types = { custom_audience: 1, lookalike: 1 };
        targetingConfig.targeting_automation = { advantage_audience: 1 };
        targetingConfig.device_platforms = ['mobile', 'desktop'];
        targetingConfig.publisher_platforms = ['facebook', 'instagram'];

        // --- Step 7: Create Ad Set ---
        logToFile("--- CREATING AD SET ---");
        const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const adSetPayload: any = {
            name: customAudienceIds?.length > 0 ? `Retargeting AdSet - Custom Audiences` : `Smart AdSet - AI Audiences`,
            campaign_id: campaignId,
            billing_event: 'IMPRESSIONS',
            targeting: {
                ...targetingConfig,
                ...(customAudienceIds?.length > 0 ? { custom_audiences: customAudienceIds.map((id: string) => ({ id })) } : {})
            },
            start_time: startTime,
            status: 'ACTIVE',
            access_token: facebookToken,
        };

        if (isWebsiteCampaign) {
            adSetPayload.destination_type = 'WEBSITE';
            adSetPayload.optimization_goal = 'OFFSITE_CONVERSIONS';
            adSetPayload.promoted_object = { pixel_id: finalPixelId, custom_event_type: 'LEAD' };
        } else {
            adSetPayload.destination_type = 'ON_AD';
            adSetPayload.optimization_goal = optimizeForConversions ? 'QUALITY_LEAD' : 'LEAD_GENERATION';
            adSetPayload.promoted_object = { page_id: pageId };
        }

        const adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adSetPayload),
        });
        const adSetData = await adSetRes.json();
        if (!adSetRes.ok) {
            const metaErr = adSetData.error || {};
            throw new Error(`Ad Set Error: ${metaErr.message || 'Unknown'}`);
        }
        const adSetId = adSetData.id;

        // --- Step 8: Create Ads ---
        logToFile("--- CREATING ADS ---");
        let successfulAds = 0;
        let lastDraftError = false;

        for (let i = 0; i < uploadedCreatives.length; i++) {
            const creativeItem = uploadedCreatives[i];
            const copy = copyVariations[i % copyVariations.length];

            const ctaValue: any = {};
            if (isWebsiteCampaign) {
                ctaValue.link = linkUrl;
            } else {
                ctaValue.lead_gen_form_id = leadFormId;
                ctaValue.link = linkUrl;
            }

            const creativePayload: any = {
                name: `Creative ${i + 1} - ${Date.now()}`,
                object_story_spec: { page_id: pageId },
                access_token: facebookToken,
            };

            if (creativeItem.type === 'video') {
                creativePayload.object_story_spec.video_data = {
                    video_id: creativeItem.videoId,
                    message: copy.primary_text,
                    title: copy.headline,
                    image_hash: globalThumbHash,
                    call_to_action: { type: 'LEARN_MORE', value: ctaValue }
                };
            } else {
                creativePayload.object_story_spec.link_data = {
                    message: copy.primary_text,
                    name: copy.headline,
                    description: copy.description,
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
            if (!creativeRes.ok) { logToFile(`Creative ${i + 1} Failed:`, creativeData); continue; }

            // Persist copy to assets table
            try {
                const assetId = assetIds?.[i % assetIds.length];
                if (assetId) {
                    const fullCaption = `${copy.headline}\n\n${copy.primary_text}${copy.description ? `\n\n${copy.description}` : ''}`;
                    await supabaseAdmin.from('assets').update({ caption: fullCaption }).eq('id', assetId);
                }
            } catch (e) { /* ignore */ }

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
                logToFile(`Ad ${i + 1} Failed:`, adData);
                if (adData.error?.error_subcode === 1359188 || adData.error?.code === 100) lastDraftError = true;
            } else {
                successfulAds++;
            }
        }

        // --- Step 9: Update job status ---
        let finalMessage = '';
        if (successfulAds === 0) {
            if (lastDraftError) {
                finalMessage = "Campaign DRAFTED! ⚠️ Payment Method Missing: Saved in Ads Manager.";
            } else {
                const errMsg = firstUploadError?.message || "All ad creative creations failed. Please check your Meta Ad Account permissions and settings.";
                throw new Error(errMsg);
            }
        } else {
            finalMessage = `Campaign Launched Successfully with ${successfulAds} AI Optimized Ads!`;
        }

        if (job) {
            await supabaseAdmin.from('campaign_jobs').update({
                status: 'completed',
                campaign_id: campaignId,
                message: finalMessage,
                updated_at: new Date().toISOString()
            }).eq('id', jobId);
        }

        logToFile("=== [JOB PROCESSOR] COMPLETED ===", { jobId, campaignId, successfulAds });

        return NextResponse.json({ success: true, campaignId, message: finalMessage });

    } catch (error: any) {
        logToFile("!!! [JOB PROCESSOR] CRASH !!!", error.message);

        if (jobId) {
            // Refund the campaign launch credit
            try {
                let uId = job?.user_id;
                if (!uId) {
                    const { data } = await supabaseAdmin.from('campaign_jobs').select('user_id').eq('id', jobId).single();
                    uId = data?.user_id;
                }
                if (uId) {
                    const { refundLimit } = await import('@/utils/subscription-server');
                    await refundLimit(uId, 'campaign_launches');
                }
            } catch (e) { /* ignore refund errors */ }

            if (job) {
                await supabaseAdmin.from('campaign_jobs').update({
                    status: 'failed',
                    message: error.message || "Internal Server Error",
                    updated_at: new Date().toISOString()
                }).eq('id', jobId);
            }
        }

        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
