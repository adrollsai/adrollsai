import { createClient } from '@supabase/supabase-js';
import { logToFile } from '@/utils/logger';
import { writeJobLocal, readJobLocal } from '@/utils/job-store';
import {
    buildStandardQuestions,
    describeLeadFormFields,
    genderTargeting,
    resolveCampaignPlan,
    type CampaignPlan,
} from '@/lib/ads/campaign-plan';
import {
    LOCATION_TYPES,
    ageAndGenderTargeting,
    applyAdvantageTargeting,
    attributionSpecFor,
    buildCampaignPayload,
    creativeEnhancements,
    describeAdvantagePlan,
    resolveAdvantagePlan,
    type AdvantagePlan,
} from '@/lib/ads/advantage-plus';
import {
    describePreflightFailure,
    validateAdSet,
    validateCampaign,
} from '@/lib/ads/preflight';
import { checkCreative, inspectRemoteImage } from '@/lib/ads/creative-checks';
import { META_GRAPH_URL } from '@/lib/ads/graph-version';
import { describeMetaError } from '@/lib/ads/graph-error';
import { buildMetaCustomQuestions } from '@/lib/ads/lead-form';

const FB_MARKETING_URL = META_GRAPH_URL;

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type UploadedCreative = {
    type: 'image' | 'video';
    hash?: string;
    videoId?: string;
};

export async function generateAICampaignCopy(
    product: any, 
    businessName: string, 
    contactNumber: string, 
    customInstructions?: string,
    creativeContext?: {
        creativeUrl?: string;
        creativeType?: string;
        index?: number;
        businessInfo?: string;
        missionStatement?: string;
    }
): Promise<{ primary_text: string; headline: string; description: string; campaign_name?: string; adset_name?: string; ad_name?: string }> {
    const forbidProjectName = customInstructions ? /do not mention|don't mention|no project name|omit project name|without project name|no name/i.test(customInstructions) : false;
    const projectTitle = (product?.title || '').trim();

    let resultCopy: { primary_text: string; headline: string; description: string; campaign_name?: string; adset_name?: string; ad_name?: string } | null = null;

    try {
        const { callGemini } = await import('./external-apis');
        
        let detailsSection = "";
        let taskRules = "";

        if (product) {
            detailsSection = `Product Details:
${forbidProjectName ? `- Title: (SECRET/DO NOT MENTION)` : `- Title: ${projectTitle || 'Exclusive Property'}`}
- Description: ${product.description || ''}
- Price: ${product.price || 'Contact for Price'}
- Location: ${product.location || ''}
- Features: Bed: ${product.beds || 'N/A'}, Bath: ${product.baths || 'N/A'}, Area: ${product.area || 'N/A'}
- Business Name: ${businessName || 'Our Agency'}
- Contact Number: ${contactNumber || ''}`;

            taskRules = `1. Primary Text: Write an engaging description (1-2 paragraphs). Highlight key selling points (e.g. location, park-facing, luxury finishes, pricing). Use professional real estate tone, bullet points for features, and include a clear call-to-action (e.g., "Tap 'Learn More' to view images and pricing details!"). Keep it under 800 characters. Append the contact number 📞 ${contactNumber} and business name 🏢 ${businessName} at the bottom.
2. Headline: Create a click-worthy, brief headline (under 40 characters) showcasing value (e.g., ${forbidProjectName ? '"Premium Residential Plots"' : '"Luxury 10 Marla House in Sector 7"'}). ${forbidProjectName ? 'DO NOT USE THE PROJECT NAME IN THE HEADLINE.' : ''}
3. Description: Write a brief subtext under the headline (under 30 characters) like "View details & pricing".`;
        } else {
            detailsSection = `Business & Creative Promotion Details:
- Business Name: ${businessName || 'Our Business'}
- Contact Number: ${contactNumber || ''}
${creativeContext?.businessInfo ? `- Business Info / Overview: ${creativeContext.businessInfo}` : ''}
${creativeContext?.missionStatement ? `- Mission / Value Proposition: ${creativeContext.missionStatement}` : ''}
${creativeContext?.creativeType ? `- Creative Asset Type: ${creativeContext.creativeType}` : ''}`;

            taskRules = `1. Campaign Name: Generate a distinct, professional Meta campaign name (under 60 characters) summarizing what is run in this campaign (e.g. "[Topic/Project/Offer] - [Audience Angle] - [Month Year]").
2. AdSet Name: Generate a clear audience/targeting name (under 50 characters) describing the intended audience or angle.
3. Ad Name: Generate a specific ad creative name (under 40 characters) reflecting the hook or creative angle.
4. Primary Text: Write a compelling, high-converting direct-response ad copy (1-2 paragraphs) presenting the business offerings, brand value, and services. Emphasize trust, customer benefits, and why they should contact or connect now. Include a clear call-to-action. Keep it under 800 characters. Append the contact number 📞 ${contactNumber} and business name 🏢 ${businessName} at the bottom.
5. Headline: Create a powerful, click-worthy hook/headline (under 40 characters) highlighting the main benefit, consultation, or special offer.
6. Description: Write a brief subtext under the headline (under 30 characters) like "Contact us today" or "Learn more now".`;
        }

        const prompt = `
You are an expert copywriter specialized in creating high-converting Facebook and Meta lead generation ads.

${detailsSection}

${customInstructions ? `Custom Copywriting Instructions / Prompt (MUST FOLLOW STRICTLY):\n"${customInstructions}"\n` : `Note: No custom prompt was provided. Craft the copy based on the business details, value proposition, and the creative being promoted.\n`}
${product && forbidProjectName ? `CRITICAL RULE: DO NOT MENTION THE PROJECT/PROPERTY NAME OR TITLE ("${projectTitle}") ANYWHERE IN THE HEADLINE, PRIMARY TEXT, OR DESCRIPTION.\n` : ''}

Task:
Generate an attractive, highly engaging ad copy, headline, and professional Meta campaign/ad naming.
Follow these rules:
${taskRules}

Return the response in JSON format matching this schema:
{
  "campaign_name": "...",
  "adset_name": "...",
  "ad_name": "...",
  "primary_text": "...",
  "headline": "...",
  "description": "..."
}
`;

        const aiResponse = await callGemini(prompt);
        // Clean JSON formatting
        const cleanJson = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const copy = JSON.parse(cleanJson);
        if (copy.primary_text && copy.headline) {
            resultCopy = {
                primary_text: copy.primary_text,
                headline: copy.headline.substring(0, 40),
                description: (copy.description || 'View details & pricing').substring(0, 30),
                campaign_name: copy.campaign_name ? copy.campaign_name.substring(0, 70) : undefined,
                adset_name: copy.adset_name ? copy.adset_name.substring(0, 60) : undefined,
                ad_name: copy.ad_name ? copy.ad_name.substring(0, 50) : undefined
            };
        }
    } catch (err: any) {
        console.error("[Processor] Failed to generate AI copy, falling back to static:", err.message);
    }
    
    // Fallback static copy if AI fails or returns invalid copy
    if (!resultCopy) {
        let primaryText = "";
        let headlineText = "";

        if (product) {
            primaryText = forbidProjectName || !projectTitle ? `${product.description || 'Exclusive Property Details'}` : `${projectTitle}\n\n${product.description || ''}`;
            headlineText = forbidProjectName || !projectTitle ? (product.location ? `Property in ${product.location}` : 'View Details & Pricing') : projectTitle;
        } else {
            primaryText = creativeContext?.businessInfo 
                ? `${creativeContext.businessInfo}\n\nConnect with us today to learn more and explore our exclusive services!`
                : `Connect with ${businessName || 'us'} today for exclusive offers, premium services, and direct consultations.`;
            headlineText = businessName ? `Connect with ${businessName}` : 'Exclusive Offer & Details';
        }

        primaryText = primaryText.substring(0, 600);
        if (contactNumber) primaryText += `\n\n📞 ${contactNumber}`;
        if (businessName) primaryText += `\n🏢 ${businessName}`;

        resultCopy = {
            headline: headlineText.substring(0, 40),
            primary_text: primaryText,
            description: 'View details & pricing'
        };
    }

    // Post-processing Sanitizer: If forbidProjectName is true, strip any occurrence of projectTitle
    if (forbidProjectName && projectTitle && projectTitle.length > 2) {
        const regex = new RegExp(projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        resultCopy.primary_text = resultCopy.primary_text.replace(regex, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
        resultCopy.headline = resultCopy.headline.replace(regex, 'Exclusive Property').trim();
        resultCopy.description = resultCopy.description.replace(regex, 'View details').trim();
    }

    return resultCopy;
}

export async function runCampaignJob(jobId: string, incomingPayload?: any): Promise<{ campaignId: string; message: string } | undefined> {
    let job: any = null;
    let payload = incomingPayload || null;

    try {
        // 1. Fetch the job from DB or fallback to local store
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

        if (!payload) {
            try {
                const localJob = readJobLocal(jobId);
                if (localJob) {
                    job = localJob;
                    payload = localJob.payload;
                    logToFile("[Processor] Using payload from local job store");
                }
            } catch (e: any) {
                logToFile("[Processor] Failed to read from local job store:", e.message);
            }
        }

        if (!payload) {
            throw new Error("Job payload not found");
        }

        if (job && job.status !== 'pending' && job.status !== 'queued' && job.status !== 'processing') {
            logToFile("[Processor] Job already processed, status:", job.status);
            return;
        }

        // 2. Mark as processing
        try {
            writeJobLocal(jobId, { status: 'processing' });
        } catch (e) {}

        if (job) {
            try {
                await supabaseAdmin.from('campaign_jobs').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', jobId);
            } catch (e) {}
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
            creativeUrls = [],
            creativeProductIds,
            whatsappNumber,
            campaignType,
            pixelId,
            ageMin,
            ageMax,
            customAudienceIds,
            adCopy,
            adCopies,
            businessName,
            contactNumber,
            currency,
            logoUrl,
            customInstructions
        } = payload;

        const isWebsiteCampaign = campaignType === 'website_conversion';
        const finalPixelId = pixelId || null;

        // One plan for the whole job: objective, destination, optimisation goal and
        // conversion event are decided once, in lib/ads/campaign-plan, so the campaign
        // and the ad set can never disagree about what this launch is for.
        const plan: CampaignPlan = resolveCampaignPlan({
            campaignType,
            campaignGoal: (payload as any).campaignGoal,
            conversionEvent: (payload as any).conversionEvent,
            optimizeForConversions,
        });
        logToFile("Campaign plan resolved:", {
            goal: plan.goal,
            objective: plan.objective,
            destination: plan.destinationType,
            optimizationGoal: plan.optimizationGoal,
            conversionEvent: plan.conversionEvent,
        });

        // The Advantage+ shape of this launch: which levers can be on, whether a
        // special ad category forbids them, and why. Almost every publish failure in
        // this launcher class came from a combination Meta refuses at review time,
        // which no API error ever showed us (see lib/ads/advantage-plus.ts).
        const advantage: AdvantagePlan = resolveAdvantagePlan({
            objective: plan.objective,
            campaignType,
            specialAdCategories: (payload as any).specialAdCategories ?? (payload as any).specialAdCategory,
            industry: (payload as any).industry || null,
            businessInfo: (payload as any).businessInfo || null,
            missionStatement: (payload as any).missionStatement || null,
            hasCustomAudience: Array.isArray(customAudienceIds) && customAudienceIds.length > 0,
            hasDetailedTargeting: Boolean((payload as any).interests?.length),
            hasAgeOrGender: Boolean((payload as any).gender) || (Number(ageMin) || 18) > 18 || (Number(ageMax) || 65) < 65,
            wantsAdvantageAudience: (payload as any).advantageAudience,
            wantsAdvantagePlacements: (payload as any).advantagePlacements,
            // Where the ads actually serve. India declares no special ad category.
            market: {
                currency: currency,
                timezone: (() => {
                    try {
                        const bi = typeof (payload as any).businessInfo === 'string'
                            ? JSON.parse((payload as any).businessInfo)
                            : (payload as any).businessInfo;
                        return bi?.timezone || null;
                    } catch { return null; }
                })(),
                phone: (payload as any).contactNumber || null,
                domain: (payload as any).linkUrl || null,
            },
        });
        logToFile("Advantage+ plan resolved:", {
            summary: describeAdvantagePlan(advantage),
            specialAdCategories: advantage.specialAdCategories,
            advantageAudience: advantage.advantageAudience,
            advantagePlacements: advantage.advantagePlacements,
            advantageState: advantage.advantageState,
            blockers: advantage.blockers,
            reasons: advantage.reasons,
        });

        logToFile("=== [JOB PROCESSOR] STARTING CAMPAIGN CREATION ===", { jobId });

        // --- Step 1: Build Creative Items ---
        interface CreativeItem {
            type: 'image' | 'video';
            url?: string;
        }
        const creativeItems: CreativeItem[] = [];

        // 1. First, build creative items from explicit creativeUrls passed in payload
        if (creativeUrls && creativeUrls.length > 0) {
            creativeUrls.forEach((url: string) => {
                if (url && typeof url === 'string' && url.startsWith('http')) {
                    const isVideo = url.toLowerCase().match(/\.(mp4|mov|avi|wmv)$/);
                    creativeItems.push({ type: isVideo ? 'video' : 'image', url });
                }
            });
        }

        // 2. Next, build creative items from assetIds (explicitly selected assets)
        if (creativeItems.length === 0 && assetIds && assetIds.length > 0) {
            const { data: rawAssets } = await supabaseAdmin
                .from('assets')
                .select('id, url, type')
                .in('id', assetIds);
            
            if (rawAssets) {
                // Reorder according to the assetIds array parameter to preserve mapped order
                const assetsMap = new Map(rawAssets.map((a: any) => [a.id, a]));
                const assets = assetIds.map((id: string) => assetsMap.get(id)).filter(Boolean);
                
                assets.forEach((asset: any) => {
                    if (asset.url) {
                        const isVideo = asset.type === 'video' || asset.url.toLowerCase().match(/\.(mp4|mov|avi|wmv)$/);
                        creativeItems.push({ type: isVideo ? 'video' : 'image', url: asset.url });
                    }
                });
            }
        }

        // 3. Only fall back to inventoryIds (product primary image) if no specific assets/urls were selected
        if (creativeItems.length === 0 && inventoryIds && inventoryIds.length > 0) {
            const { data: props } = await supabaseAdmin
                .from('properties')
                .select('title, description, images, image_url')
                .in('id', inventoryIds);
            if (props) {
                props.forEach((prop: any) => {
                    if (prop.image_url) {
                        creativeItems.push({ type: 'image', url: prop.image_url });
                    } else if (prop.images && Array.isArray(prop.images) && prop.images.length > 0) {
                        const firstImg = prop.images.find((i: string) => i && i.startsWith('http'));
                        if (firstImg) {
                            creativeItems.push({ type: 'image', url: firstImg });
                        }
                    }
                });
            }
        }

        if (creativeItems.length === 0) {
            throw new Error("No images or videos found in the selected properties or assets.");
        }

        // --- Step 1b: Check the creatives before Meta sees them ---
        //
        // Meta accepts almost any image and then refuses to serve it (or crops it) with
        // an issue nobody reads until the campaign is live. Reading the header here costs
        // one 64 KB range request per image and lets us say what is wrong while it is
        // still fixable: a video is not stopped, an image only when Meta is certain to
        // reject it.
        const creativeReport: Array<{ url: string; summary: string; level: string; issues: string[] }> = [];
        for (const item of creativeItems) {
            if (!item.url) continue;
            if (item.type === 'video') {
                const check = checkCreative({ kind: 'video' });
                creativeReport.push({ url: item.url, summary: check.summary, level: check.level, issues: check.issues.map((i) => i.code) });
                continue;
            }
            const check = await inspectRemoteImage(item.url);
            creativeReport.push({
                url: item.url,
                summary: check.summary,
                level: check.level,
                issues: check.issues.map((i) => i.code),
            });
            if (check.blocked) {
                throw new Error(
                    `Creative rejected before upload: ${check.summary} Fix the image and launch again — ` +
                    `nothing was created on Meta.`
                );
            }
        }
        const creativeWarnings = creativeReport.filter((c) => c.level === 'warning');
        logToFile("Creative pre-checks:", creativeReport);
        if (creativeWarnings.length) {
            logToFile(`[Processor] ${creativeWarnings.length} creative(s) will serve in fewer placements:`,
                creativeWarnings.map((c) => `${c.url.slice(-40)} — ${c.summary}`).join(' | '));
        }

        // --- Step 2: Upload Creatives to Meta ---
        logToFile("--- UPLOADING CREATIVES TO META ---");
        const uploadedCreatives: UploadedCreative[] = [];
        let globalThumbHash: string | null = null;

        // Prepare thumbnail if videos exist
        const hasVideos = creativeItems.some(item => item.type === 'video');
        if (hasVideos) {
            if (logoUrl) {
                try {
                    const thumbFetch = await fetch(logoUrl);
                    if (thumbFetch.ok) {
                        const thumbBlob = await thumbFetch.blob();
                        const thumbData = new FormData();
                        thumbData.append('source', thumbBlob, `thumb_${Date.now()}.png`);
                        thumbData.append('access_token', facebookToken);
                        const thumbRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, { method: 'POST', body: thumbData });
                        const thumbResult = await thumbRes.json();
                        if (thumbResult.images) {
                            globalThumbHash = thumbResult.images[Object.keys(thumbResult.images)[0]].hash;
                            logToFile(`Successfully uploaded custom logo thumbnail to Meta. Hash: ${globalThumbHash}`);
                        }
                    }
                } catch (e: any) {
                    logToFile("Failed to prepare custom logo thumbnail:", e.message);
                }
            }

            // If still null, generate and upload an in-memory 1x1 PNG thumbnail to Meta (guaranteed to succeed without external network)
            if (!globalThumbHash) {
                try {
                    const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
                    const pngBuffer = Buffer.from(base64Png, 'base64');
                    const thumbBlob = new Blob([pngBuffer], { type: 'image/png' });
                    const thumbData = new FormData();
                    thumbData.append('source', thumbBlob, `default_thumb_${Date.now()}.png`);
                    thumbData.append('access_token', facebookToken);
                    const thumbRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, { method: 'POST', body: thumbData });
                    const thumbResult = await thumbRes.json();
                    if (thumbResult.images) {
                        globalThumbHash = thumbResult.images[Object.keys(thumbResult.images)[0]].hash;
                        logToFile(`Successfully uploaded in-memory fallback thumbnail to Meta. Hash: ${globalThumbHash}`);
                    }
                } catch (fallbackErr: any) {
                    logToFile("Failed to upload fallback thumbnail to Meta:", fallbackErr.message);
                }
            }
        }

        let firstUploadError: any = null;
        for (let i = 0; i < creativeItems.length; i++) {
            const item = creativeItems[i];
            try {
                if (item.type === 'video') {
                    let videoId: string | null = null;
                    let uploadError: any = null;

                    // 1. Try uploading to Meta via file_url if the URL is public and remote
                    const isPublicUrl = item.url && item.url.startsWith('http') && !item.url.includes('localhost') && !item.url.includes('127.0.0.1') && !item.url.includes('::1');
                    
                    if (isPublicUrl && item.url) {
                        try {
                            logToFile(`Uploading video via Meta file_url (JSON): ${item.url}`);
                            const videoRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/advideos`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    file_url: item.url,
                                    access_token: facebookToken
                                })
                            });
                            
                            const resText = await videoRes.text();
                            logToFile(`Meta file_url response status: ${videoRes.status}`);
                            
                            let videoResult: any = {};
                            try {
                                videoResult = JSON.parse(resText);
                            } catch (parseErr) {
                                throw new Error(`Failed to parse Meta response as JSON (Status ${videoRes.status}): ${resText.substring(0, 500)}`);
                            }
                            
                            if (videoResult.id) {
                                videoId = videoResult.id;
                                logToFile(`Successfully uploaded video via file_url. Meta ID: ${videoId}`);
                            } else {
                                uploadError = videoResult.error || { message: `file_url upload failed (Status ${videoRes.status}): ${resText}` };
                                logToFile(`Meta file_url upload failed:`, uploadError);
                            }
                        } catch (e: any) {
                            uploadError = { message: e.message };
                            logToFile(`Error uploading video via file_url: ${e.message}`);
                        }
                    }

                    // 2. Fallback to downloading video and doing a binary upload if file_url failed or is local
                    if (!videoId && item.url) {
                        try {
                            logToFile(`Falling back to downloading video for binary upload: ${item.url}`);
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout for video

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
                            logToFile(`Meta binary fallback response status: ${videoRes.status}`);
                            
                            let videoResult: any = {};
                            try {
                                videoResult = JSON.parse(resText);
                            } catch (parseErr) {
                                throw new Error(`Failed to parse Meta binary response as JSON (Status ${videoRes.status}): ${resText.substring(0, 500)}`);
                            }
                            
                            if (videoResult.id) {
                                videoId = videoResult.id;
                                logToFile(`Successfully uploaded video via binary upload fallback. Meta ID: ${videoId}`);
                            } else {
                                uploadError = videoResult.error || { message: `Binary fallback upload failed (Status ${videoRes.status}): ${resText}` };
                                logToFile(`Binary fallback upload failed:`, uploadError);
                            }
                        } catch (e: any) {
                            uploadError = { message: e.message };
                            logToFile(`Error during binary video upload fallback: ${e.message}`);
                        }
                    }

                    if (videoId) {
                        uploadedCreatives.push({ type: 'video', videoId });
                    } else {
                        firstUploadError = uploadError || { message: "Video upload failed" };
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
            logToFile("Polling Meta to ensure uploaded videos are ready...");
            for (const c of uploadedCreatives) {
                if (c.type === 'video' && c.videoId) {
                    let attempts = 0;
                    while (attempts < 5) {
                        try {
                            const statusRes = await fetch(`${FB_MARKETING_URL}/${c.videoId}?fields=status&access_token=${facebookToken}`);
                            const statusData = await statusRes.json();
                            logToFile(`Video ${c.videoId} processing status:`, statusData);
                            if (statusData.status?.video_status === 'ready') {
                                break;
                            }
                        } catch (e) {}
                        attempts++;
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            }
        }
        logToFile(`Uploaded ${uploadedCreatives.length} creatives to Meta.`);

        // --- Step 3: Generate AI copies using Gemini ---
        logToFile("--- GENERATING AI AD COPIES WITH GEMINI ---");
        const allProductIds = creativeProductIds || inventoryIds || [];
        const { data: propertiesList } = await supabaseAdmin
            .from('properties')
            .select('*')
            .in('id', allProductIds);
        
        const propertiesMap = new Map(propertiesList?.map((p: any) => [p.id, p]) || []);

        const copyVariations = [];
        for (let i = 0; i < uploadedCreatives.length; i++) {
            // Find corresponding productId for this creative
            const prodId = creativeProductIds && creativeProductIds[i] ? creativeProductIds[i] : (inventoryIds && inventoryIds[0]);
            const product = propertiesMap.get(prodId) || null;
            
            const creativeContext = {
                creativeUrl: (creativeUrls && creativeUrls[i]) || undefined,
                creativeType: uploadedCreatives[i]?.type || 'image',
                index: i + 1,
                businessInfo: payload.businessInfo || payload.business_info,
                missionStatement: payload.missionStatement || payload.mission_statement
            };

            logToFile(`[Processor] Generating AI copy for Creative ${i+1}${product ? ` using Product: ${product.title}` : ' using Business Info & Creative context'}`);
            const aiCopy = await generateAICampaignCopy(product, businessName, contactNumber, customInstructions, creativeContext);
            
            const specificCopy = adCopies && adCopies[i] ? adCopies[i] : null;
            
            copyVariations.push({
                primary_text: aiCopy?.primary_text || specificCopy?.primary_text || adCopy?.primary_text || "View pricing & details now.",
                headline: aiCopy?.headline || specificCopy?.headline || "View Details",
                description: aiCopy?.description || specificCopy?.description || "Contact us today.",
                campaign_name: aiCopy?.campaign_name || specificCopy?.campaign_name,
                adset_name: aiCopy?.adset_name || specificCopy?.adset_name,
                ad_name: aiCopy?.ad_name || specificCopy?.ad_name
            });
        }

        // --- Step 4: Create or Resolve Lead Form ---
        // --- Step 4: Create or Resolve Lead Form ---
        let leadFormId = payload.existingLeadFormId || payload.leadFormId || payload.lead_form_id || payload.formId || null;
        const requiresLeadForm = !isWebsiteCampaign && campaignType !== 'whatsapp_chat';
        if (requiresLeadForm && !leadFormId) {
            logToFile("--- RESOLVING / CREATING LEAD FORM ---");

            // Obtain Page Access Token (Meta strictly requires Page Token for leadgen_forms)
            let pageAccessToken = payload.selected_page_token || payload.pageToken;
            const effectiveTargetUserId = job?.target_user_id || payload.targetUserId || payload.target_user_id;
            if (!pageAccessToken && effectiveTargetUserId) {
                try {
                    const { data: prof } = await supabaseAdmin
                        .from('profiles')
                        .select('selected_page_token')
                        .eq('id', effectiveTargetUserId)
                        .single();
                    if (prof?.selected_page_token) pageAccessToken = prof.selected_page_token;
                } catch (e) {}
            }

            // Always resolve the dedicated Page Access Token directly for this pageId via Meta API using the active facebookToken
            if (facebookToken && pageId) {
                try {
                    const pRes = await fetch(`${FB_MARKETING_URL}/${pageId}?fields=access_token&access_token=${facebookToken}`);
                    const pData = await pRes.json();
                    if (pData?.access_token) {
                        pageAccessToken = pData.access_token;
                        logToFile(`Resolved dedicated Page Access Token for page ${pageId}`);
                    }
                } catch (e) {}
            }

            const tokenForLeadForm = pageAccessToken || facebookToken;

            // 1. If user provided a specific leadFormId, we use it directly.
            // Otherwise, ALWAYS create a new instant lead form matching the user's campaign configuration & custom questions!
            if (!leadFormId) {
                logToFile("Creating new instant lead form on Meta Page...");
                const formConfig = payload.leadFormConfig || null;

                // The standard fields are the client's choice, defaulting to
                // Name + WhatsApp number + City. Every field is a reason to abandon the
                // form, so the default deliberately does NOT ask for an email: the CRM,
                // the calling queue and the WhatsApp journey all key off phone + city.
                // Resolved BEFORE the custom questions so the de-duplication below knows
                // which standard fields are already on the form.
                const standardQuestions: any[] = buildStandardQuestions(
                    formConfig?.standardFields ?? formConfig?.standardQuestions
                );
                const standardTypes = new Set(standardQuestions.map((q) => q.type));
                if (formConfig?.includeCity && !standardTypes.has('CITY')) {
                    standardQuestions.push(buildStandardQuestions(['CITY'])[0]);
                    standardTypes.add('CITY');
                }

                let metaCustomQuestions: any[] = [];
                let hasCustomQuestions = false;

                // Merge questions from formConfig.questions or legacy customQuestionsStr
                const rawQuestions = (formConfig?.questions && Array.isArray(formConfig.questions))
                    ? formConfig.questions
                    : (() => {
                        if (customQuestionsStr && customQuestionsStr !== "[]") {
                            try { return JSON.parse(customQuestionsStr); } catch (e) { return []; }
                        }
                        return [];
                    })();

                if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
                    /**
                     * Meta's own words, from a live client's failed launch:
                     *   "label must be specified for custom questions"
                     *
                     * That decision lives in lib/ads/lead-form.ts now, with tests, because a
                     * mapping bug belongs in a mapping function — not three lines inside a
                     * 1,500-line processor where the only way to find it is to read a failed
                     * Graph response. The rules it applies: take the wording from whichever
                     * field carries it, drop a question that cannot be expressed instead of
                     * posting it blank, and only send a choice question with two real options.
                     */
                    const mapped = buildMetaCustomQuestions(rawQuestions, standardTypes);
                    metaCustomQuestions = mapped.questions;

                    if (mapped.dropped.length) {
                        logToFile(
                            `[Processor] Dropped ${mapped.dropped.length} custom question(s) Meta would refuse:`,
                            mapped.dropped
                        );
                    }

                    hasCustomQuestions = metaCustomQuestions.length > 0;
                }

                const finalFollowUpUrl = linkUrl || "https://adrolls.in";
                // The name now states the fields the form actually carries, so an operator
                // reading the Page's form list can tell two campaigns apart.
                const questionLabels = metaCustomQuestions.map((q: any) => q.label || q.type).filter(Boolean).map((label: string) => label.replace(/[?:]/g, '').trim()).join(', ');
                const defaultFormName = `Form - ${businessName} - (${describeLeadFormFields(formConfig?.standardFields ?? formConfig?.standardQuestions)}${questionLabels ? `, ${questionLabels}` : ''}) - ${Date.now().toString().slice(-6)}`;
                const formName = formConfig?.name || defaultFormName;

                // Meta official documentation: is_continued_flow = true enforces HIGHER INTENT review step
                const isHighIntent = formConfig ? formConfig.formType !== 'MORE_VOLUME' : true;

                const leadFormPayload: any = {
                    name: formName,
                    is_continued_flow: isHighIntent,
                    follow_up_action_url: finalFollowUpUrl,
                    question_page_custom_headline: formConfig?.headline || `Get Pricing & Details`,
                    question_page_custom_text: formConfig?.greetingText || "Confirm details to view pricing.",
                    privacy_policy: {
                        url: (formConfig?.privacyPolicyUrl || privacyPolicyUrl) && !(formConfig?.privacyPolicyUrl || privacyPolicyUrl).includes('localhost') 
                            ? (formConfig?.privacyPolicyUrl || privacyPolicyUrl) 
                            : "https://adrolls.in/privacy",
                        link_text: formConfig?.privacyPolicyLinkText || "Privacy Policy"
                    },
                    questions: [
                        ...standardQuestions,
                        ...metaCustomQuestions
                    ],
                    thank_you_page: {
                        title: formConfig?.completionTitle || "Thank you! You're all set.",
                        body: formConfig?.completionBody || "Our representative will contact you shortly with the brochure.",
                        button_text: formConfig?.completionButtonText || (formConfig?.completionAction === 'whatsapp' ? "Chat on WhatsApp" : "Visit Website"),
                        button_type: "VIEW_WEBSITE",
                        website_url: finalFollowUpUrl
                    },
                    access_token: tokenForLeadForm
                };

                logToFile(`[Processor] Submitting Lead Form to Meta. High Intent: ${isHighIntent}`);
                let formCreateRes = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify(leadFormPayload)
                });
                let formCreateData = await formCreateRes.json();

                // If Meta rejected optional thank_you_page block, retry with simplified payload
                if (!formCreateRes.ok && formCreateData.error) {
                    logToFile("Lead Form creation initial attempt returned error, trying standard payload:", formCreateData.error);
                    const simplifiedPayload = {
                        name: formName,
                        is_continued_flow: isHighIntent,
                        follow_up_action_url: finalFollowUpUrl,
                        question_page_custom_headline: formConfig?.headline || `Get Pricing & Details`,
                        question_page_custom_text: formConfig?.greetingText || "Confirm details to view pricing.",
                        privacy_policy: leadFormPayload.privacy_policy,
                        questions: leadFormPayload.questions,
                        access_token: tokenForLeadForm
                    };
                    formCreateRes = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json; charset=utf-8' },
                        body: JSON.stringify(simplifiedPayload)
                    });
                    formCreateData = await formCreateRes.json();
                }

                if (formCreateRes.ok && formCreateData.id) {
                    leadFormId = formCreateData.id;
                    logToFile(`Lead Form Created: ${leadFormId} (High Intent: ${isHighIntent})`);
                } else {
                    logToFile("Lead Form Creation Failed:", formCreateData);
                    // Name the field Meta blamed, not just its headline. "label must be specified
                    // for custom questions" is actionable; "Invalid parameter" is not.
                    const formFailure =
                        describeMetaError(formCreateData, 'Meta rejected the instant lead form') ||
                        `Meta Lead Form Error: ${formCreateData.error?.error_user_msg || formCreateData.error?.message || 'Unknown Error'}`;
                    // If user had specified custom questions, don't silently pick a random old form with wrong questions
                    if (hasCustomQuestions) {
                        throw new Error(formFailure);
                    }
                    
                    // Fallback only if no custom questions were required
                    logToFile("Attempting fallback to find an existing active lead form on this page...");
                    try {
                        const existingFormsRes = await fetch(`${FB_MARKETING_URL}/${pageId}/leadgen_forms?access_token=${tokenForLeadForm}&limit=10`);
                        const existingFormsData = await existingFormsRes.json();
                        if (existingFormsData?.data && Array.isArray(existingFormsData.data) && existingFormsData.data.length > 0) {
                            const activeForm = existingFormsData.data.find((f: any) => f.status === 'ACTIVE') || existingFormsData.data[0];
                            if (activeForm?.id) {
                                leadFormId = activeForm.id;
                                logToFile(`Fallback reused existing active lead form: ${leadFormId} (${activeForm.name})`);
                            }
                        }
                    } catch (formFindErr: any) {
                        logToFile("Could not list existing lead forms for fallback:", formFindErr.message);
                    }

                    if (!leadFormId) {
                        throw new Error(formFailure);
                    }
                }
            }
        }

        // --- Step 5: Create Campaign ---
        logToFile("--- CREATING CAMPAIGN ---");
        let campaignSubject = "";
        if (inventoryIds && inventoryIds.length > 0) {
            const { data: props } = await supabaseAdmin
                .from('properties')
                .select('title')
                .in('id', inventoryIds);
            
            if (props && props.length > 0) {
                const titles = props.map((p: any) => p.title).filter(Boolean);
                if (titles.length === 1) {
                    campaignSubject = titles[0];
                } else if (titles.length > 1) {
                    const firstPart = titles[0];
                    const remaining = titles.length - 1;
                    campaignSubject = `${firstPart} + ${remaining} other${remaining > 1 ? 's' : ''}`;
                }
            }
        }

        if (!campaignSubject) {
            if (customInstructions && customInstructions.trim().length > 0) {
                campaignSubject = customInstructions.replace(/[^\w\s-]/g, '').trim().split(/\s+/).slice(0, 5).join(' ');
            } else if (copyVariations[0]?.headline) {
                campaignSubject = copyVariations[0].headline.replace(/[^\w\s-]/g, '').trim().split(/\s+/).slice(0, 5).join(' ');
            } else {
                campaignSubject = "Lead Generation";
            }
        }

        const dateStr = new Date().toISOString().slice(0, 10);
        const randSuffix = Date.now().toString().slice(-4);
        const defaultAiCampaignName = copyVariations[0]?.campaign_name 
            ? `${copyVariations[0].campaign_name} - ${randSuffix}`
            : `${campaignSubject} - ${businessName} - ${dateStr} - ${randSuffix}`;
        const campaignName = payload.campaign_name || payload.campaignName || defaultAiCampaignName;

        const campaignPayload = buildCampaignPayload({
            name: campaignName,
            plan: advantage,
            dailyBudget,
            status: 'ACTIVE',
            accessToken: facebookToken,
        });

        // ASK BEFORE CREATING. Meta's validate_only runs the full validation and makes
        // nothing: no campaign shell, no orphan to clean up, no launch credit spent on
        // a request it was always going to refuse (a budget under its floor, an
        // objective it no longer serves, a category combination it will not publish).
        const campaignPreflight = await validateCampaign(adAccountId, campaignPayload, facebookToken);
        if (!campaignPreflight.ok) {
            logToFile("Campaign pre-flight refused by Meta:", campaignPreflight);
            throw new Error(describePreflightFailure(campaignPreflight, 'campaign'));
        }

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
        let targetingConfig: any = { geo_locations: { countries: ['IN'], location_types: [...LOCATION_TYPES] } };
        let parsedLocations = false;
        if (metaLocationsStr) {
            try {
                const locationsArray = typeof metaLocationsStr === 'string' && (metaLocationsStr.startsWith('[') || metaLocationsStr.startsWith('{'))
                    ? JSON.parse(metaLocationsStr)
                    : null;
                if (Array.isArray(locationsArray) && locationsArray.length > 0) {
                    targetingConfig = { 
                        geo_locations: { 
                            cities: [], 
                            regions: [], 
                            countries: [], 
                            zips: [], 
                            location_types: [...LOCATION_TYPES] 
                        } 
                    };
                    locationsArray.forEach((locData: any) => {
                        const loc = locData.location || locData;
                        if (loc && (loc.type === 'custom_location' || locData.latitude || loc.latitude)) {
                            const lat = Number(locData.latitude || loc.latitude);
                            const lng = Number(locData.longitude || loc.longitude);
                            const rad = Math.max(1, Math.min(80, Number(locData.radius || loc.radius || 15)));
                            if (!isNaN(lat) && !isNaN(lng)) {
                                if (!targetingConfig.geo_locations.custom_locations) {
                                    targetingConfig.geo_locations.custom_locations = [];
                                }
                                targetingConfig.geo_locations.custom_locations.push({
                                    latitude: lat,
                                    longitude: lng,
                                    radius: rad,
                                    distance_unit: 'kilometer'
                                });
                            }
                        } else if (loc && loc.key) {
                            const rad = locData.radius || loc.radius || 25;
                            const finalRadius = Math.max(17, Math.min(80, rad));
                            if (loc.type === 'city') targetingConfig.geo_locations.cities.push({ key: loc.key, radius: finalRadius, distance_unit: 'kilometer' });
                            else if (loc.type === 'region') targetingConfig.geo_locations.regions.push({ key: loc.key });
                            else if (loc.type === 'country') targetingConfig.geo_locations.countries.push(loc.country_code || loc.key);
                            else if (loc.type === 'zip') targetingConfig.geo_locations.zips.push({ key: loc.key });
                        }
                    });

                    // Add pins from payload.droppedPins if provided
                    if (Array.isArray(payload.droppedPins) && payload.droppedPins.length > 0) {
                        if (!targetingConfig.geo_locations.custom_locations) {
                            targetingConfig.geo_locations.custom_locations = [];
                        }
                        payload.droppedPins.forEach((pin: any) => {
                            const lat = Number(pin.latitude || pin.lat);
                            const lng = Number(pin.longitude || pin.lng);
                            const rad = Math.max(1, Math.min(80, Number(pin.radius || 15)));
                            if (!isNaN(lat) && !isNaN(lng)) {
                                targetingConfig.geo_locations.custom_locations.push({
                                    latitude: lat,
                                    longitude: lng,
                                    radius: rad,
                                    distance_unit: 'kilometer'
                                });
                            }
                        });
                    }

                    const hasGranular = (targetingConfig.geo_locations.cities && targetingConfig.geo_locations.cities.length > 0) || 
                                        (targetingConfig.geo_locations.regions && targetingConfig.geo_locations.regions.length > 0) || 
                                        (targetingConfig.geo_locations.zips && targetingConfig.geo_locations.zips.length > 0) ||
                                        (targetingConfig.geo_locations.custom_locations && targetingConfig.geo_locations.custom_locations.length > 0);
                    if (hasGranular) delete targetingConfig.geo_locations.countries;
                    else if (targetingConfig.geo_locations.countries.length === 0) targetingConfig.geo_locations.countries.push('IN');

                    if (targetingConfig.geo_locations.cities.length === 0) delete targetingConfig.geo_locations.cities;
                    if (targetingConfig.geo_locations.regions.length === 0) delete targetingConfig.geo_locations.regions;
                    if (targetingConfig.geo_locations.zips.length === 0) delete targetingConfig.geo_locations.zips;
                    if (targetingConfig.geo_locations.custom_locations && targetingConfig.geo_locations.custom_locations.length === 0) delete targetingConfig.geo_locations.custom_locations;
                    parsedLocations = true;
                }
            } catch (e) {
                logToFile("Failed to parse locations JSON", e);
            }
        }

        // Also check if standalone payload.droppedPins provided without metaLocations
        if (!parsedLocations && Array.isArray(payload.droppedPins) && payload.droppedPins.length > 0) {
            targetingConfig = {
                geo_locations: {
                    custom_locations: [],
                    location_types: [...LOCATION_TYPES]
                }
            };
            payload.droppedPins.forEach((pin: any) => {
                const lat = Number(pin.latitude || pin.lat);
                const lng = Number(pin.longitude || pin.lng);
                const rad = Math.max(1, Math.min(80, Number(pin.radius || 15)));
                if (!isNaN(lat) && !isNaN(lng)) {
                    targetingConfig.geo_locations.custom_locations.push({
                        latitude: lat,
                        longitude: lng,
                        radius: rad,
                        distance_unit: 'kilometer'
                    });
                }
            });
            parsedLocations = true;
        }

        // If not structured JSON, support plain text locations e.g. "Pune", "Delhi NCR", "Chandigarh, Mohali & Panchkula"
        if (!parsedLocations) {
            let combinedLocsStr = '';
            if (Array.isArray(payload.target_locations)) {
                combinedLocsStr = payload.target_locations.join(', ');
            } else if (typeof metaLocationsStr === 'string') {
                combinedLocsStr = metaLocationsStr;
            } else if (typeof payload.target_locations === 'string') {
                combinedLocsStr = payload.target_locations;
            }

            // Split by comma, &, 'and', plus, and slashes e.g. "Chandigarh, Mohali & Panchkula" -> ["Chandigarh", "Mohali", "Panchkula"]
            const rawLocs = combinedLocsStr
                .split(/[,&/+]|\band\b/i)
                .map((s: string) => s.trim())
                .filter(Boolean);

            if (rawLocs.length > 0) {
                const citiesFound: any[] = [];
                for (const locName of rawLocs) {
                    try {
                        // Extract radius if specified in string e.g. "Chandigarh (17 km)" -> 17
                        const radiusMatch = locName.match(/\((\d+)\s*(?:km|kms|kilometer)?\)/i);
                        const parsedRadius = radiusMatch ? parseInt(radiusMatch[1], 10) : 25;
                        const radiusVal = Math.max(17, Math.min(80, parsedRadius));

                        // Strip radius and extra words for pure city lookup on Meta
                        let cleanQuery = locName.replace(/\(.*?\)/g, '').replace(/\bncr\b/i, '').trim() || locName.trim();
                        
                        // Handle common Indian aliases
                        if (cleanQuery.toLowerCase() === 'gurgaon') cleanQuery = 'Gurugram';
                        else if (cleanQuery.toLowerCase() === 'bombay') cleanQuery = 'Mumbai';
                        else if (cleanQuery.toLowerCase() === 'calcutta') cleanQuery = 'Kolkata';
                        else if (cleanQuery.toLowerCase() === 'bangalore') cleanQuery = 'Bengaluru';

                        let searchRes = await fetch(`${FB_MARKETING_URL}/search?type=adgeolocation&q=${encodeURIComponent(cleanQuery)}&location_types=["city"]&access_token=${facebookToken}`);
                        let searchData = await searchRes.json();
                        let match = searchData.data?.find((c: any) => c.country_code === 'IN') || searchData.data?.[0];

                        // If no match and query has formal prefix/suffix, strip and retry e.g. "Sri Muktsar Sahib" -> "Muktsar"
                        if (!match && /^(?:sri|shri)\s+/i.test(cleanQuery)) {
                            const retryQuery = cleanQuery.replace(/^(?:sri|shri)\s+/i, '').replace(/\s+(?:sahib|district|city)$/i, '').trim();
                            const retryRes = await fetch(`${FB_MARKETING_URL}/search?type=adgeolocation&q=${encodeURIComponent(retryQuery)}&location_types=["city"]&access_token=${facebookToken}`);
                            const retryData = await retryRes.json();
                            match = retryData.data?.find((c: any) => c.country_code === 'IN') || retryData.data?.[0];
                        }

                        if (match?.key && !citiesFound.some((c: any) => c.key === match.key)) {
                            citiesFound.push({ key: match.key, radius: radiusVal, distance_unit: 'kilometer' });
                        }
                    } catch (geoErr) {
                        logToFile(`Geo search error for ${locName}:`, geoErr);
                    }
                }

                if (citiesFound.length > 0) {
                    targetingConfig = {
                        geo_locations: {
                            cities: citiesFound,
                            location_types: [...LOCATION_TYPES]
                        }
                    };
                    delete targetingConfig.geo_locations.countries;
                    logToFile("Successfully resolved city targeting from text:", citiesFound);
                } else {
                    logToFile(`ERROR: Failed to resolve any Meta city for: ${rawLocs.join(', ')}`);
                    throw new Error(`Could not resolve Meta targeting for specified locations: ${rawLocs.join(', ')}. Please use the location picker to select exact cities.`);
                }
            }
        }

        // Age, gender and the Advantage+ automation levers now come from the plan.
        //
        // This used to send `advantage_audience: 0` plus a Facebook/Instagram-only
        // placement restriction on every single launch, which is why no campaign this
        // platform built could ever be an Advantage+ campaign: Meta requires the
        // campaign budget, the audience and the placements levers together. A special
        // ad category additionally forbids age/gender targeting outright.
        const ageGender = ageAndGenderTargeting(advantage, ageMin, ageMax, (payload as any).gender, genderTargeting);
        targetingConfig.age_min = ageGender.age_min;
        if (ageGender.age_max < 65) {
            targetingConfig.age_max = ageGender.age_max;
        } else {
            delete targetingConfig.age_max;
        }
        if (ageGender.genders) {
            targetingConfig.genders = ageGender.genders;
        } else {
            delete targetingConfig.genders;
        }
        targetingConfig = applyAdvantageTargeting(targetingConfig, advantage);

        // --- Meta Official Detailed Targeting (flexible_spec) ---
        const interestsList = payload.interests || payload.detailedTargeting || [];
        if (Array.isArray(interestsList) && interestsList.length > 0) {
            targetingConfig.flexible_spec = [
                {
                    interests: interestsList.map((item: any) => ({
                        id: String(item.id),
                        name: item.name || ''
                    }))
                }
            ];
            logToFile(`[Processor] Attached Detailed Targeting flexible_spec: ${interestsList.length} interests`, targetingConfig.flexible_spec);
        }

        // --- Step 7: Create Ad Set ---
        logToFile("--- CREATING AD SET ---");
        const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const defaultAiAdsetName = copyVariations[0]?.adset_name || (
            customAudienceIds?.length > 0 
                ? `Retargeting AdSet - Custom Audiences` 
                : `${campaignSubject} - Targeted Audience`
        );
        const adSetName = payload.adset_name || payload.adsetName || defaultAiAdsetName;

        const adSetPayload: any = {
            name: adSetName,
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
            adSetPayload.destination_type = plan.destinationType;
            adSetPayload.optimization_goal = plan.optimizationGoal;
            adSetPayload.promoted_object = {
                pixel_id: finalPixelId,
                custom_event_type: plan.conversionEvent || 'LEAD',
            };
        } else if (campaignType === 'whatsapp_chat') {
            adSetPayload.destination_type = plan.destinationType;
            adSetPayload.optimization_goal = plan.optimizationGoal;
            
            let cleanPhone = "";
            if (whatsappNumber) {
                cleanPhone = whatsappNumber.replace(/[^0-9]/g, '');
                if (cleanPhone.length === 10) {
                    cleanPhone = "91" + cleanPhone;
                }
            }

            adSetPayload.promoted_object = { 
                page_id: pageId,
                ...(cleanPhone ? { whatsapp_phone_number: "+" + cleanPhone } : {})
            };
        } else {
            adSetPayload.destination_type = plan.destinationType;
            adSetPayload.optimization_goal = plan.optimizationGoal;
            adSetPayload.promoted_object = { page_id: pageId };
        }

        // Attribution, explicitly. Meta only accepts a 1-day click window on a lead
        // campaign (7-day click and any view-through window are rejected), so send it
        // rather than inheriting an account default nobody can see.
        const attributionSpec = attributionSpecFor(plan.objective);
        if (attributionSpec) {
            adSetPayload.attribution_spec = attributionSpec;
        }

        // Same pre-flight as the campaign: this is where targeting combinations Meta
        // refuses actually show up (a special category plus Advantage+ audience, a
        // country mixed with a city, an age ceiling below 65 under Advantage+).
        const adSetPreflight = await validateAdSet(adAccountId, adSetPayload, facebookToken);
        if (!adSetPreflight.ok) {
            logToFile("Ad set pre-flight refused by Meta:", adSetPreflight);
            try {
                await fetch(`${FB_MARKETING_URL}/${campaignId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'ARCHIVED', access_token: facebookToken })
                });
            } catch (cleanupErr) { /* ignore cleanup error */ }
            throw new Error(describePreflightFailure(adSetPreflight, 'ad set'));
        }

        const adSetRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adSetPayload),
        });
        const adSetData = await adSetRes.json();
        if (!adSetRes.ok) {
            const metaErr = adSetData.error || {};
            // Auto-archive orphaned empty campaign to prevent leaving an empty campaign shell
            try {
                await fetch(`${FB_MARKETING_URL}/${campaignId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'ARCHIVED', access_token: facebookToken })
                });
            } catch (cleanupErr) { /* ignore cleanup error */ }
            const metaErrMsg = metaErr.error_user_msg || metaErr.error_user_title || metaErr.message || 'Unknown error';
            throw new Error(`Ad Set Error: ${metaErrMsg}`);
        }
        const adSetId = adSetData.id;

        // --- Step 8: Create Ads ---
        logToFile("--- CREATING ADS ---");
        let successfulAds = 0;
        let lastDraftError = false;
        let lastAdError: any = null;
        let lastCreativeError: any = null;

        for (let i = 0; i < uploadedCreatives.length; i++) {
            const creativeItem = uploadedCreatives[i];
            const copy = copyVariations[i % copyVariations.length];

            let cleanPhone = (whatsappNumber || '').replace(/[^0-9]/g, '');
            if (cleanPhone && cleanPhone.length === 10) {
                cleanPhone = "91" + cleanPhone;
            }
            const waLink = cleanPhone ? `https://api.whatsapp.com/send?phone=${cleanPhone}` : `https://api.whatsapp.com/send`;

            const ctaType = campaignType === 'whatsapp_chat' ? 'WHATSAPP_MESSAGE' : 'LEARN_MORE';
            const ctaValue: any = {};
            if (campaignType === 'whatsapp_chat') {
                ctaValue.app_destination = 'WHATSAPP';
                ctaValue.link = waLink;
            } else if (isWebsiteCampaign) {
                ctaValue.link = linkUrl;
            } else {
                ctaValue.lead_gen_form_id = leadFormId;
                ctaValue.link = linkUrl;
            }

            const defaultAdName = copy.ad_name 
                ? copy.ad_name 
                : (copy.headline ? `${copy.headline.slice(0, 35)} (Ad ${i + 1})` : `Ad Variation ${i + 1}`);

            const creativePayload: any = {
                name: `${defaultAdName} - Creative`,
                object_story_spec: { page_id: pageId },
                // Advantage+ creative enhancements in the shape v22+ accepts. The
                // friendly `standard_enhancements` name is rejected on v22 and later
                // (subcode 3858504), which is why this comes from the shared module.
                degrees_of_freedom_spec: creativeEnhancements(),
                access_token: facebookToken,
            };

            if (creativeItem.type === 'video') {
                creativePayload.object_story_spec.video_data = {
                    video_id: creativeItem.videoId,
                    message: copy.primary_text,
                    title: copy.headline,
                    image_hash: globalThumbHash,
                    call_to_action: { type: ctaType, value: ctaValue }
                };
            } else {
                creativePayload.object_story_spec.link_data = {
                    message: copy.primary_text,
                    name: copy.headline,
                    description: copy.description,
                    link: campaignType === 'whatsapp_chat' ? waLink : linkUrl,
                    image_hash: creativeItem.hash,
                    call_to_action: { type: ctaType, value: ctaValue }
                };
            }

            const creativeRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adcreatives`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(creativePayload),
            });
            const creativeData = await creativeRes.json();
            if (!creativeRes.ok) { 
                lastCreativeError = creativeData.error;
                const creativeErr = creativeData.error?.error_user_msg || creativeData.error?.message || JSON.stringify(creativeData);
                logToFile(`Creative ${i + 1} Failed: ${creativeErr}`, creativeData);
                continue; 
            }

            // Persist copy to assets table
            try {
                const assetId = assetIds?.[i % assetIds.length];
                if (assetId) {
                    const fullCaption = `${copy.headline}\n\n${copy.primary_text}${copy.description ? `\n\n${copy.description}` : ''}`;
                    await supabaseAdmin.from('assets').update({ caption: fullCaption }).eq('id', assetId);
                }
            } catch (e) { /* ignore */ }

            const adPayload: any = {
                name: defaultAdName,
                adset_id: adSetId,
                creative: { creative_id: creativeData.id },
                status: 'ACTIVE',
                access_token: facebookToken,
            };

            // Meta Official Ad Tracking Specs: Connects Dataset / Pixel to the ad for conversion tracking and algorithm optimization
            if (finalPixelId) {
                adPayload.tracking_specs = [
                    {
                        "action.type": ["offsite_conversion"],
                        "fb_pixel": [String(finalPixelId)]
                    }
                ];
                logToFile(`[Processor] Attached tracking_specs for Dataset/Pixel: ${finalPixelId}`);
            }

            let adRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/ads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(adPayload),
            });
            let adData = await adRes.json();

            if (!adRes.ok) {
                logToFile(`Ad ${i + 1} Failed with status ACTIVE, retrying with status PAUSED. Error details:`, adData);
                
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
                    logToFile(`Ad ${i + 1} Retry with status PAUSED also Failed:`, retryData);
                    lastAdError = retryData.error || adData.error;
                    if (retryData.error?.error_subcode === 1359188 || adData.error?.error_subcode === 1359188) {
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

        // --- Step 9: Update job status ---
        let finalMessage = '';
        if (successfulAds === 0) {
            // Auto-cleanup: Pause orphan campaign on Meta so an empty campaign doesn't remain ACTIVE
            if (campaignId) {
                try {
                    await fetch(`${FB_MARKETING_URL}/${campaignId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'PAUSED', access_token: facebookToken })
                    });
                    logToFile(`Paused orphan campaign ${campaignId} on Meta due to 0 ads created.`);
                } catch (cleanupErr) { /* ignore cleanup error */ }
            }

            let errMsg = "Ad creation failed on Meta. Please check your Meta Ad Account settings.";
            if (lastAdError) {
                const subcode = lastAdError.error_subcode;
                const userMsg = lastAdError.error_user_msg;
                const userTitle = lastAdError.error_user_title;
                const rawMsg = lastAdError.message;
                
                if (subcode === 1359188) {
                    errMsg = `Meta Payment Method Missing: Please add a valid payment method in Meta Ads Manager Billing before launching ads.`;
                } else if (subcode === 2859002 || userTitle?.toLowerCase().includes('certification') || userMsg?.toLowerCase().includes('nondiscrimination') || rawMsg?.toLowerCase().includes('nondiscrimination')) {
                    errMsg = `Meta Non-Discrimination Certification Required: ${userMsg || 'You must certify compliance with Meta\'s non-discrimination policy before running ads. Visit facebook.com/certification/nondiscrimination to certify.'}`;
                } else if (userMsg) {
                    errMsg = `Meta Ad Error (${userTitle || 'Policy'}): ${userMsg}`;
                } else if (rawMsg) {
                    errMsg = `Meta Ad Error: ${rawMsg}`;
                }
            } else if (lastCreativeError) {
                const cMsg = lastCreativeError.error_user_msg || lastCreativeError.message || JSON.stringify(lastCreativeError);
                errMsg = `Meta Ad Creative Error: ${cMsg}`;
            } else if (firstUploadError?.message) {
                errMsg = `Creative Upload Error: ${firstUploadError.message}`;
            }
            throw new Error(errMsg);
        } else {
            // Say what was actually built. "Launched Successfully" told the client
            // nothing about whether Meta will treat it as an Advantage+ campaign, and
            // the first anyone heard about a special ad category was a publish error.
            const shape = describeAdvantagePlan(advantage);
            if (lastDraftError) {
                finalMessage = `Campaign DRAFTED! ⚠️ Saved in Ads Manager with ${successfulAds} ads (Payment method required to activate). Setup: ${shape}.`;
            } else {
                finalMessage = `Campaign Launched Successfully with ${successfulAds} AI Optimized Ads! Setup: ${shape}.`;
            }
            if (advantage.blockers.length) {
                finalMessage += ` Note: ${advantage.blockers.join(' ')}`;
            }
            if (creativeWarnings.length) {
                finalMessage +=
                    ` Creative note: ${creativeWarnings.length === 1 ? 'one image serves in' : `${creativeWarnings.length} images serve in`}` +
                    ` fewer placements — ${creativeWarnings[0].summary}` +
                    `${creativeWarnings.length > 1 ? ` (and ${creativeWarnings.length - 1} more)` : ''}.`;
            }
        }

        try {
            writeJobLocal(jobId, {
                status: 'completed',
                campaign_id: campaignId,
                message: finalMessage
            });
        } catch (e) {}

        if (job) {
            try {
                await supabaseAdmin.from('campaign_jobs').update({
                    status: 'completed',
                    campaign_id: campaignId,
                    message: finalMessage,
                    updated_at: new Date().toISOString()
                }).eq('id', jobId);
            } catch (e) {}
        }

        logToFile("=== [JOB PROCESSOR] COMPLETED ===", { jobId, campaignId, successfulAds });

        // Send Push Notification on Success
        try {
            const uId = job?.user_id || payload?.userId;
            if (uId) {
                const { sendPushNotification } = await import('@/utils/notification-helper');
                await sendPushNotification(
                    uId,
                    '🚀 Campaign Launched Live!',
                    `Your campaign "${campaignName}" is now active on Meta.`,
                    '/dashboard/ads',
                    'campaign_success'
                );
            }
        } catch (e) {}

        return { campaignId, message: finalMessage };

    } catch (error: any) {
        logToFile("!!! [JOB PROCESSOR] CRASH !!!", error.message);

        if (jobId) {
            // Refund the campaign launch credit
            try {
                let uId = job?.user_id;
                if (!uId) {
                    try {
                        const { data } = await supabaseAdmin.from('campaign_jobs').select('user_id').eq('id', jobId).single();
                        uId = data?.user_id;
                    } catch (e) {}
                }
                if (!uId) {
                    try {
                        uId = readJobLocal(jobId)?.user_id;
                    } catch (e) {}
                }
                if (uId) {
                    const { refundLimit } = await import('@/utils/subscription-server');
                    await refundLimit(uId, 'campaign_launches');

                    // Send Push Notification on Failure
                    try {
                        const { sendPushNotification } = await import('@/utils/notification-helper');
                        await sendPushNotification(
                            uId,
                            '❌ Campaign Launch Failed',
                            `Launch failed: ${error.message || 'Meta API rejected the request'}. Your launch credit has been refunded.`,
                            '/dashboard/ads',
                            'campaign_failure'
                        );
                    } catch (notifErr) {}
                }
            } catch (e) { /* ignore refund errors */ }

            try {
                writeJobLocal(jobId, {
                    status: 'failed',
                    message: error.message || "Internal Server Error"
                });
            } catch (e) {}

            if (job) {
                try {
                    await supabaseAdmin.from('campaign_jobs').update({
                        status: 'failed',
                        message: error.message || "Internal Server Error",
                        updated_at: new Date().toISOString()
                    }).eq('id', jobId);
                } catch (e) {}
            }
        }

        // Re-throw so the caller can handle it
        throw error;
    }
}
