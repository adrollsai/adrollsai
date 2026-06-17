import crypto from 'crypto';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_VEO_GENERATE_URL = "https://api.kie.ai/api/v1/veo/generate";
const KIE_VEO_EXTEND_URL = "https://api.kie.ai/api/v1/veo/extend";
const FACEBOOK_GRAPH_URL = "https://graph.facebook.com/v19.0";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Interface for the Kie AI Task Response to prevent null-pointer errors.
 */
interface KieTaskResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    status?: string;
    url?: string;
  };
  error?: string;
}

/**
 * Helper to fetch with retry logic for rate limits (429 or Meta Error Codes)
 */
async function fetchWithRetry(url: string, options: any, maxRetries = 3): Promise<Response> {
    let retries = 0;
    while (retries < maxRetries) {
        const response = await fetch(url, options);
        
        // 1. Handle standard HTTP 429
        if (response.status === 429) {
            const waitTime = Math.pow(2, retries) * 2000 + Math.random() * 1000;
            console.log(`[Rate Limit] Hit 429, retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            retries++;
            continue;
        }

        // 2. Handle Meta-Specific Rate Limits (Status 400/403 with error codes 4, 17, 32)
        if (!response.ok) {
            try {
                const clone = response.clone();
                const errorData = await clone.json();
                const metaErrorCode = errorData.error?.code;
                const metaErrorMsg = errorData.error?.message || "";

                if ([4, 17, 32, 613].includes(metaErrorCode) || metaErrorMsg.includes("request limit reached")) {
                    const waitTime = Math.pow(2, retries) * 3000 + Math.random() * 1000;
                    console.warn(`[Meta Rate Limit] Code ${metaErrorCode} hit. Retrying in ${waitTime}ms... (Attempt ${retries + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    retries++;
                    continue;
                }
            } catch (e) {
                // Not JSON or other error, proceed to return original response
            }
        }

        return response;
    }
    return fetch(url, options); // Final attempt
}

/**
 * 1. Kie.ai Task Generation (Video/Image/Misc)
 * Updated with robust error handling and standardized return objects.
 */
export async function createKieTask(payload: any): Promise<{ taskId: string | null; error: string | null }> {
    if (!KIE_API_KEY) return { taskId: null, error: "KIE_API_KEY is not configured." };
    
    try {
        const response = await fetchWithRetry(KIE_CREATE_TASK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KIE_API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        const result: KieTaskResponse = await response.json();

        if (!response.ok || (result.code !== 0 && result.code !== 200)) {
            return { 
                taskId: null, 
                error: result.msg || result.error || `Kie AI Task creation failed with status ${response.status}` 
            };
        }

        return { 
            taskId: result.data?.taskId || null, 
            error: null 
        };

    } catch (e: any) {
        return { taskId: null, error: `Network error: ${e.message}` };
    }
}

/**
 * 2. Facebook Posting 
 */
export async function postToFacebook(accessToken: string, imageUrl: string, caption: string): Promise<any> {
    const response = await fetch(`${FACEBOOK_GRAPH_URL}/me/photos`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            access_token: accessToken,
            url: imageUrl,
            message: caption,
            published: true,
        }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Facebook API Error: ${data.error?.message || response.statusText}`)
    }
    return data;
}

/**
 * 3. Instagram Posting (Upgraded with Polling & Rate Limit Resilience)
 */
export async function postToInstagram(accessToken: string, pageId: string, mediaUrl: string, caption: string): Promise<any> {
    // 1. Get IG Account ID (Try to be efficient)
    const igAccountRes = await fetchWithRetry(`${FACEBOOK_GRAPH_URL}/${pageId}?fields=instagram_business_account&access_token=${accessToken}`, {});
    const igAccountData = await igAccountRes.json();
    if (igAccountData.error || !igAccountData.instagram_business_account?.id) {
        throw new Error(`Failed to get IG Account ID: ${igAccountData.error?.message || 'Page not connected to IG'}`);
    }
    const igAccountId = igAccountData.instagram_business_account.id;

    // 2. Detect Media Type
    const isVideo = mediaUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)$/) || mediaUrl.includes('video');
    const mediaPayload: any = {
        caption: caption,
        access_token: accessToken,
    };

    if (isVideo) {
        mediaPayload.video_url = mediaUrl;
        mediaPayload.media_type = 'VIDEO';
    } else {
        mediaPayload.image_url = mediaUrl;
    }

    // 3. Create Media Container
    const containerRes = await fetchWithRetry(`${FACEBOOK_GRAPH_URL}/${igAccountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mediaPayload),
    });
    const containerData = await containerRes.json();
    if (containerData.error || !containerData.id) {
        throw new Error(`Failed to create IG media container: ${containerData.error?.message || 'Unknown Error'}`);
    }
    const creationId = containerData.id;

    // 4. POLL STATUS FOR VIDEOS ONLY (Images are processed synchronously by Meta, and requesting status_description on image containers returns an OAuth error)
    if (isVideo) {
        let status = 'IN_PROGRESS';
        let attempts = 0;
        while (status !== 'FINISHED' && attempts < 15) {
            await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15s (Conserves API limit)
            const statusRes = await fetchWithRetry(`${FACEBOOK_GRAPH_URL}/${creationId}?fields=status_code,status_description&access_token=${accessToken}`, {});
            const statusData = await statusRes.json();
            status = statusData.status_code;
            
            if (status === 'ERROR') {
                throw new Error(`Instagram processing failed: ${statusData.status_description || 'Unknown Meta processing error'}`);
            }
            attempts++;
        }

        if (status !== 'FINISHED') {
            throw new Error("Instagram media processing timed out. Please try again in a few minutes.");
        }
    }

    // 5. Publish Container
    const publishRes = await fetchWithRetry(`${FACEBOOK_GRAPH_URL}/${igAccountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            creation_id: creationId,
            access_token: accessToken,
        }),
    });
    const publishData = await publishRes.json();
    if (publishData.error) {
        throw new Error(`Failed to publish to Instagram: ${publishData.error?.message || 'Unknown Error'}`);
    }
    return publishData;
}

/**
 * 3.5 LinkedIn Posting (Latest 2026 Versioned REST API)
 */
export async function postToLinkedin(accessToken: string, linkedinId: string, assetUrl: string, commentary: string, type: string = 'image'): Promise<any> {
    const urn = `urn:li:person:${linkedinId}`
    const linkedinVersion = '202604'
    let assetUrn = null

    if (assetUrl) {
        const isVideo = type === 'video'
        const initEndpoint = isVideo 
            ? 'https://api.linkedin.com/rest/videos?action=initializeUpload'
            : 'https://api.linkedin.com/rest/images?action=initializeUpload'

        // 1. Initialize
        const initRes = await fetch(initEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Linkedin-Version': linkedinVersion,
                'X-Restli-Protocol-Version': '2.0.0',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                initializeUploadRequest: { owner: urn }
            })
        })
        const initData = await initRes.json()
        if (!initRes.ok) throw new Error(`LinkedIn Init Error: ${initData.message || 'Failed'}`)

        const uploadUrl = isVideo ? initData.value.uploadInstructions[0].uploadUrl : initData.value.uploadUrl
        assetUrn = isVideo ? initData.value.video : initData.value.image

        // 2. Upload Binary
        const fileRes = await fetch(assetUrl)
        const fileBlob = await fileRes.arrayBuffer()
        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': type === 'video' ? 'video/mp4' : 'image/jpeg'
            },
            body: fileBlob
        })
        if (!uploadRes.ok) throw new Error('LinkedIn Binary Upload Failed')

        // 2.5 Wait for processing
        await new Promise(resolve => setTimeout(resolve, 3000))
    }

    // 3. Create Post
    const payload: any = {
        author: urn,
        commentary: commentary,
        visibility: 'PUBLIC',
        distribution: {
            feedDistribution: 'MAIN_FEED'
        },
        lifecycleState: 'PUBLISHED'
    }

    if (assetUrn) {
        payload.content = {
            media: {
                id: assetUrn
            }
        }
    }

    const response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Linkedin-Version': linkedinVersion,
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    })

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'LinkedIn API error' }))
        throw new Error(errorData.message || `LinkedIn error ${response.status}`)
    }

    const postId = response.headers.get('x-restli-id')
    return { id: postId }
}

/**
 * 4. Kie.ai Chat API (Upgraded for Multimodal Vision) - Redirected to Official Gemini
 */
export async function generateKieChat(prompt: string, model: string = "gemini-3-flash-preview", imageUrl?: string): Promise<string> {
    return callGemini(prompt, imageUrl ? [imageUrl] : undefined);
}

/**
 * 5. Gemini Content Generation (Official Google Gemini API via SDK)
 * Upgraded to support multimodal vision (images) and standard models
 */
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateContentWithFallback } from "./gemini-fallback";

export async function callGemini(prompt: string, imageUrls?: string[]): Promise<string> {
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
    
    try {
        
        const contents: any[] = [prompt];
        
        if (imageUrls && imageUrls.length > 0) {
            for (const url of imageUrls) {
                if (url.startsWith('data:')) {
                    const [header, base64Data] = url.split(',');
                    const mimeType = header.split(':')[1].split(';')[0];
                    
                    contents.push({
                        inlineData: {
                            data: base64Data,
                            mimeType
                        }
                    });
                } else {
                    try {
                        const isVideo = url.toLowerCase().match(/\.(mp4|mov|avi|wmv|webm)$/) || url.includes('video');
                        
                        if (isVideo) {
                            console.log("[Gemini] Video detected, uploading to Google AI File Manager:", url);
                            
                            // 1. Download to Buffer
                            const videoRes = await fetch(url);
                            const videoBuffer = await videoRes.arrayBuffer();
                            
                            // 2. Upload to Google
                            const uploadResult = await fileManager.uploadFile(
                                Buffer.from(videoBuffer), 
                                { mimeType: 'video/mp4', displayName: 'Campaign Video' }
                            );

                            // 3. Wait for file to be ACTIVE
                            let file = await fileManager.getFile(uploadResult.file.name);
                            let attempts = 0;
                            while (file.state === FileState.PROCESSING && attempts < 20) {
                                console.log(`[Gemini] Processing video: ${file.name}... State: ${file.state}`);
                                await new Promise(resolve => setTimeout(resolve, 3000));
                                file = await fileManager.getFile(uploadResult.file.name);
                                attempts++;
                            }

                            if (file.state !== FileState.ACTIVE) {
                                throw new Error(`Video processing failed or timed out: ${file.state}`);
                            }

                            // 4. Use the file URI
                            contents.push({
                                fileData: {
                                    fileUri: file.uri,
                                    mimeType: file.mimeType
                                }
                            });
                        } else {
                            // For images via URL, we have to download them for the native SDK 
                            // or pass them as inlineData if small
                            const imgRes = await fetch(url);
                            const imgBuffer = await imgRes.arrayBuffer();
                            const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
                            
                            contents.push({
                                inlineData: {
                                    data: Buffer.from(imgBuffer).toString('base64'),
                                    mimeType
                                }
                            });
                        }
                    } catch (e: any) {
                        console.error("Asset processing failed for Gemini:", url, e.message);
                        contents.push(`[Context: Asset at ${url}]`);
                    }
                }
            }
        }

        const result = await generateContentWithFallback(
            genAI,
            contents,
            "gemini-3.5-flash",
            "gemini-3-flash-preview"
        );
        const response = await result.response;
        return response.text();

    } catch (e: any) {
        console.error("[Gemini Native Error]", e);
        throw new Error(`Gemini Native Error: ${e.message}`);
    }
}

/**
 * 6. Fetch Lead Forms List
 */
export async function fetchLeadForms(accessToken: string, pageId: string): Promise<any[]> {
    try {
        const response = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}/leadgen_forms?fields=id,name,status,leads_count&limit=100&access_token=${accessToken}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.data || [];
    } catch (e: any) {
        throw new Error(`Failed to fetch forms: ${e.message}`);
    }
}

/**
 * 7. Fetch Facebook Leads from Lead Forms
 */
export async function fetchFacebookLeads(accessToken: string, pageId: string, specificFormId?: string): Promise<any[]> {
    try {
        const formsRes = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}/leadgen_forms?fields=id,name&limit=500&access_token=${accessToken}`);
        const formsData = await formsRes.json();
        if (formsData.error) throw new Error(formsData.error.message);
        
        let formsToProcess = formsData.data || [];
        if (specificFormId) {
            formsToProcess = formsToProcess.filter((f: any) => f.id === specificFormId);
        }

        const allLeads = [];
        for (const form of formsToProcess) {
            let nextUrl = `${FACEBOOK_GRAPH_URL}/${form.id}/leads?fields=id,created_time,field_data,ad_id,ad_name&limit=200&access_token=${accessToken}`;
            while (nextUrl) {
                const leadsRes = await fetch(nextUrl);
                const leadsData = await leadsRes.json();
                
                if (leadsData.error) {
                    console.error("Meta Leads API Error:", leadsData.error);
                    throw new Error(`Meta Leads Error: ${leadsData.error.message}`);
                }

                if (leadsData.data && leadsData.data.length > 0) {
                    const formattedLeads = leadsData.data.map((l: any) => {
                        const customFields: Record<string, any> = {}
                        let name = 'Unknown', email = '', phone = ''

                        let firstName = '', lastName = ''
                        l.field_data?.forEach((field: any) => {
                            if (!field.name || !field.values || field.values.length === 0) return;
                            
                            const fn = field.name.toLowerCase()
                            const fv = field.values[0]
                            if (fn === 'full_name' || fn === 'name') name = fv
                            else if (fn === 'first_name') firstName = fv
                            else if (fn === 'last_name') lastName = fv
                            else if (fn === 'email') email = fv
                            else if (fn === 'phone_number' || fn === 'phone' || fn === 'mobile_number' || fn === 'whatsapp_number') phone = fv
                            else customFields[field.name] = fv
                        })

                        if (name === 'Unknown' && (firstName || lastName)) {
                            name = `${firstName} ${lastName}`.trim()
                        }

                        const sourceTag = l.ad_name ? `${l.ad_name} | ${form.name}` : form.name;
                        return {
                            facebook_lead_id: l.id,
                            name,
                            email,
                            phone,
                            source: 'Facebook',
                            form_id: form.id,
                            form_name: form.name,
                            custom_fields: customFields,
                            ad_name: sourceTag, 
                            facebook_created_at: l.created_time
                        };
                    });
                    allLeads.push(...formattedLeads);
                }
                nextUrl = leadsData.paging?.next || null;
            }
        }
        return allLeads;
    } catch (e: any) {
        throw new Error(`FB Leads Sync Error: ${e.message}`);
    }
}

/**
 * 8. Send Facebook CAPI Event
 */
export async function sendCAPIEvent(
    accessToken: string, 
    pixelId: string, 
    eventName: string, 
    userData: { 
        email?: string, 
        phone?: string,
        firstName?: string,
        lastName?: string,
        externalId?: string
    }, 
    value?: number,
    clientIp?: string,
    clientUa?: string,
    sourceUrl?: string
) {
    if (!pixelId) return;
    const hashData = (data: string) => crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
    const cleanPhone = (phone: string) => phone.replace(/\D/g, ''); // Keep only digits

    const payload = {
        data: [{
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website', 
            event_source_url: sourceUrl || undefined,
            user_data: {
                em: userData.email ? [hashData(userData.email)] : [],
                ph: userData.phone ? [hashData(cleanPhone(userData.phone))] : [],
                fn: userData.firstName ? [hashData(userData.firstName)] : [],
                ln: userData.lastName ? [hashData(userData.lastName)] : [],
                external_id: userData.externalId ? [userData.externalId] : [], // Unhashed standard unique CRM ID
                client_ip_address: clientIp || undefined,
                client_user_agent: clientUa || undefined
            },
            custom_data: {
                currency: 'INR',
                value: value || 0
            }
        }],
        access_token: accessToken
    };
    try {
        const response = await fetch(`${FACEBOOK_GRAPH_URL}/${pixelId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
            console.error("CAPI Meta Error:", JSON.stringify(result, null, 2));
        } else {
            console.log(`CAPI Event '${eventName}' Sent. Meta Response:`, result);
        }
    } catch (e) {
        console.error("CAPI Network Error:", e);
    }
}

/**
 * 9. Fetch Facebook Pixels for Ad Account
 */
export async function fetchFacebookPixels(accessToken: string, adAccountId: string): Promise<any[]> {
    try {
        const response = await fetch(`${FACEBOOK_GRAPH_URL}/${adAccountId}/adspixels?fields=name,id&access_token=${accessToken}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.data || [];
    } catch (e: any) {
        throw new Error(`Failed to fetch Pixels: ${e.message}`);
    }
}

/**
 * 10. Kie.ai Image Generator (For Auto-Optimizer)
 */
export async function createKieImageTask(
    prompt: string, 
    model: string = "gpt-image-2-text-to-image", 
    aspectRatio: string = "1:1",
    inputUrls?: string[]
): Promise<string> {
    if (!KIE_API_KEY) throw new Error("KIE_API_KEY is not configured.");

    const inputPayload: any = {
        prompt: prompt,
        aspect_ratio: aspectRatio,
        resolution: "1K"
    };

    if (inputUrls && inputUrls.length > 0) {
        inputPayload.input_urls = inputUrls;
    }

    const response = await fetchWithRetry(KIE_CREATE_TASK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KIE_API_KEY}` },
        body: JSON.stringify({ 
            model: model, 
            input: inputPayload 
        })
    });
    const data = await response.json();
    console.log("[createKieImageTask] API Response:", JSON.stringify(data));
    if (!response.ok || (data.code !== 0 && data.code !== 200)) {
        throw new Error(data.msg || data.error || `Image task creation failed with status ${response.status}`);
    }
    if (!data.data?.taskId) throw new Error("Kie AI response missing taskId");
    return data.data.taskId;
}

/**
 * 11. Kie.ai Veo 3.1 Video Generator (Lite Model)
 */
export async function createVeoTask(payload: any): Promise<{ taskId: string | null; error: string | null }> {
    if (!KIE_API_KEY) return { taskId: null, error: "KIE_API_KEY is not configured." };
    
    try {
        const response = await fetchWithRetry(KIE_VEO_GENERATE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KIE_API_KEY}`
            },
            body: JSON.stringify({
                ...payload,
                model: payload.model || "veo3_lite",
                resolution: payload.resolution || "720p"
            })
        });

        const result: KieTaskResponse = await response.json();

        if (!response.ok || (result.code !== 0 && result.code !== 200)) {
            return { 
                taskId: null, 
                error: result.msg || result.error || `Veo AI Task creation failed with status ${response.status}` 
            };
        }

        return { 
            taskId: result.data?.taskId || null, 
            error: null 
        };

    } catch (e: any) {
        return { taskId: null, error: `Network error: ${e.message}` };
    }
}

/**
 * 12. Kie.ai Veo 3.1 Video Extension (Lite Model)
 */
export async function extendVeoTask(payload: any): Promise<{ taskId: string | null; error: string | null }> {
    if (!KIE_API_KEY) return { taskId: null, error: "KIE_API_KEY is not configured." };
    
    try {
        const response = await fetchWithRetry(KIE_VEO_EXTEND_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KIE_API_KEY}`
            },
            body: JSON.stringify({
                ...payload,
                model: payload.model || "lite"
            })
        });

        const result: KieTaskResponse = await response.json();

        if (!response.ok || (result.code !== 0 && result.code !== 200)) {
            return { 
                taskId: null, 
                error: result.msg || result.error || `Veo AI Extension failed with status ${response.status}` 
            };
        }

        return { 
            taskId: result.data?.taskId || null, 
            error: null 
        };

    } catch (e: any) {
        return { taskId: null, error: `Network error: ${e.message}` };
    }
}