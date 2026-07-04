import { createClient } from '@supabase/supabase-js';
import { logToFile } from '@/utils/logger';
import { writeJobLocal, readJobLocal } from '@/utils/job-store';

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type UploadedCreative = {
    type: 'image' | 'video';
    hash?: string;
    videoId?: string;
};

async function generateAICampaignCopy(product: any, businessName: string, contactNumber: string): Promise<{ primary_text: string; headline: string; description: string }> {
    try {
        const { callGemini } = await import('./external-apis');
        
        const prompt = `
You are an expert real estate copywriter specialized in creating high-converting Facebook and Meta lead generation ads.

Product Details:
- Title: ${product.title || 'Exclusive Property'}
- Description: ${product.description || ''}
- Price: ${product.price || 'Contact for Price'}
- Location: ${product.location || ''}
- Features: Bed: ${product.beds || 'N/A'}, Bath: ${product.baths || 'N/A'}, Area: ${product.area || 'N/A'}
- Business Name: ${businessName || 'Our Agency'}
- Contact Number: ${contactNumber || ''}

Task:
Generate a compelling, attractive, and highly engaging real estate ad copy and headline for this property.
Follow these rules:
1. Primary Text: Write an engaging description (1-2 paragraphs). Highlight key selling points (e.g. location, park-facing, luxury finishes, pricing). Use professional real estate tone, bullet points for features, and include a clear call-to-action (e.g., "Tap 'Learn More' to view images and pricing details!"). Keep it under 800 characters. Append the contact number 📞 ${contactNumber} and business name 🏢 ${businessName} at the bottom.
2. Headline: Create a click-worthy, brief headline (under 40 characters) showcasing value (e.g., "Luxury 10 Marla House in Sector 7" or "Park-Facing covered area").
3. Description: Write a brief subtext under the headline (under 30 characters) like "View details & pricing".

Return the response in JSON format matching this schema:
{
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
            return {
                primary_text: copy.primary_text,
                headline: copy.headline.substring(0, 40),
                description: (copy.description || 'View details & pricing').substring(0, 30)
            };
        }
    } catch (err: any) {
        console.error("[Processor] Failed to generate AI copy, falling back to static:", err.message);
    }
    
    // Fallback static copy if AI fails
    let primaryText = `${product.title || 'Exclusive Property'}\n\n${product.description || ''}`.substring(0, 600);
    if (contactNumber) primaryText += `\n\n📞 ${contactNumber}`;
    if (businessName) primaryText += `\n🏢 ${businessName}`;
    return {
        headline: (product.title || 'View Details').substring(0, 40),
        primary_text: primaryText,
        description: 'View details & pricing'
    };
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

        if (job && job.status !== 'pending' && job.status !== 'processing') {
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
            logToFile("Waiting 5 seconds for Meta to process uploaded videos...");
            await new Promise(resolve => setTimeout(resolve, 5000));
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
            const product = propertiesMap.get(prodId);
            
            let aiCopy = null;
            if (product) {
                logToFile(`[Processor] Generating AI copy for Creative ${i+1} using Product: ${product.title}`);
                aiCopy = await generateAICampaignCopy(product, businessName, contactNumber);
            }
            
            const specificCopy = adCopies && adCopies[i] ? adCopies[i] : null;
            
            copyVariations.push({
                primary_text: aiCopy?.primary_text || specificCopy?.primary_text || adCopy?.primary_text || "View pricing & details now.",
                headline: aiCopy?.headline || specificCopy?.headline || "View Details",
                description: aiCopy?.description || specificCopy?.description || "Contact us today."
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
        let campaignSubject = "AI Smart Campaign";
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

        const campaignName = `${businessName} - ${customAudienceIds?.length > 0 ? 'Retargeting' : campaignSubject} - ${new Date().toISOString().slice(0, 10)} - ${Date.now().toString().slice(-4)}`;

        const campaignPayload = {
            name: campaignName,
            objective: campaignType === 'whatsapp_chat' ? 'OUTCOME_ENGAGEMENT' : 'OUTCOME_LEADS',
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

        targetingConfig.age_min = ageMin !== undefined && ageMin !== null ? ageMin : 18;
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
        } else if (campaignType === 'whatsapp_chat') {
            adSetPayload.destination_type = 'WHATSAPP';
            adSetPayload.optimization_goal = 'REPLIES';
            adSetPayload.promoted_object = { page_id: pageId };
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

            const ctaType = campaignType === 'whatsapp_chat' ? 'WHATSAPP_MESSAGE' : 'LEARN_MORE';
            const ctaValue: any = {};
            if (isWebsiteCampaign) {
                ctaValue.link = linkUrl;
            } else if (campaignType === 'whatsapp_chat') {
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
                    call_to_action: { type: ctaType, value: ctaValue }
                };
            } else {
                creativePayload.object_story_spec.link_data = {
                    message: copy.primary_text,
                    name: copy.headline,
                    description: copy.description,
                    link: linkUrl,
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
