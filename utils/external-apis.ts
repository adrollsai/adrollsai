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
 * Query task status from Kie.ai (GET /api/v1/jobs/recordInfo)
 */
export async function queryKieTask(taskId: string): Promise<{ state: string; resultUrl: string | null; error: string | null }> {
    if (!KIE_API_KEY) return { state: 'fail', resultUrl: null, error: "KIE_API_KEY is not configured." };
    
    try {
        const response = await fetchWithRetry(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${KIE_API_KEY}`
            }
        });

        const result = await response.json();
        if (!response.ok || (result.code !== 0 && result.code !== 200)) {
            return { state: 'fail', resultUrl: null, error: result.msg || "Query task failed" };
        }

        const data = result.data;
        const state = data?.state || 'waiting';

        if (state === 'fail') {
            return { state: 'fail', resultUrl: null, error: data?.failMsg || "Task failed on server" };
        }

        if (state === 'success') {
            let resultUrl: string | null = null;
            if (data?.resultJson) {
                try {
                    const parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
                    const urls = parsed.resultUrls || parsed.result_urls || parsed.fullResultUrls || parsed.urls;
                    if (Array.isArray(urls) && urls.length > 0) {
                        resultUrl = urls[0];
                    } else if (parsed.url) {
                        resultUrl = parsed.url;
                    } else if (parsed.resultObject?.url) {
                        resultUrl = parsed.resultObject.url;
                    } else if (parsed.audio_url || parsed.audioUrl) {
                        resultUrl = parsed.audio_url || parsed.audioUrl;
                    }
                } catch (e) {
                    console.error("[queryKieTask] Error parsing resultJson:", e);
                }
            }

            if (!resultUrl && data?.resultUrl) {
                resultUrl = data.resultUrl;
            }

            return { state: 'success', resultUrl, error: null };
        }

        return { state, resultUrl: null, error: null };

    } catch (e: any) {
        return { state: 'fail', resultUrl: null, error: e.message };
    }
}

/**
 * Helper to generate voiceover audio using google/gemini-3-1-flash-tts via Kie.ai
 */
export async function createGeminiTTS({
    dialogueText,
    speakerName = "Zephyr",
    style = "",
    scene = "Professional studio recording",
    sampleContext = "High converting marketing voiceover",
    callBackUrl
}: {
    dialogueText: string;
    speakerName?: string;
    style?: string;
    scene?: string;
    sampleContext?: string;
    callBackUrl?: string;
}): Promise<{ taskId: string | null; error: string | null }> {
    const payload: any = {
        model: "google/gemini-3-1-flash-tts",
        input: {
            speakers: [{
                speaker_id: "Speaker 1",
                voice_name: speakerName,
                audio_profile: "",
                style: "", // Always empty string as Kie.ai rejects non-empty style strings with HTTP 422
                pace: "Natural",
                accent: "Neutral"
            }],
            dialogue_turns: [{
                speaker_id: "Speaker 1",
                text: dialogueText
            }],
            temperature: 1,
            scene,
            sample_context: sampleContext
        }
    };

    if (callBackUrl) {
        payload.callBackUrl = callBackUrl;
    }

    return createKieTask(payload);
}

/**
 * Helper to create video task using Grok Imagine Video 1.5 Preview via Kie.ai
 * Supports up to 7 input images simultaneously (image_urls array)
 */
export async function createGrokVideoTask({
    prompt,
    collageImageUrl,
    imageUrls,
    aspectRatio = "9:16",
    resolution = "480p",
    duration = 15,
    callBackUrl
}: {
    prompt: string;
    collageImageUrl?: string;
    imageUrls?: string[];
    aspectRatio?: string;
    resolution?: string;
    duration?: number;
    callBackUrl?: string;
}): Promise<{ taskId: string | null; error: string | null }> {
    const inputPayload: any = {
        prompt,
        aspect_ratio: aspectRatio,
        resolution,
        duration,      // Range: [1, 15], default is 8. Must be inside input!
        nsfw_checker: true
    };

    if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
        // Grok Imagine 1.5 allows up to 7 images in image_urls
        inputPayload.image_urls = imageUrls.filter(u => u && typeof u === 'string' && u.startsWith('http')).slice(0, 7);
    } else if (collageImageUrl) {
        inputPayload.image_urls = [collageImageUrl];
    }

    const payload: any = {
        model: "grok-imagine-video-1-5-preview",
        input: inputPayload
    };

    if (callBackUrl) {
        payload.callBackUrl = callBackUrl;
    }

    return createKieTask(payload);
}

/**
 * 2. Facebook Posting (Supports both Photos and Videos)
 */
export async function postToFacebook(accessToken: string, mediaUrl: string, caption: string, type: string = 'image', pageId?: string): Promise<any> {
    const isVideo = type === 'video' || !!mediaUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)(\?|$)/) || mediaUrl.includes('/video/');
    const targetNode = pageId || 'me';
    let cleanMediaUrl = mediaUrl;
    if (cleanMediaUrl.includes('r2.dev/adrolls-storage/')) {
        cleanMediaUrl = cleanMediaUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/');
    }

    if (isVideo) {
        console.log(`[Facebook API] Posting video to Facebook page via /${targetNode}/videos...`);
        const response = await fetch(`${FACEBOOK_GRAPH_URL}/${targetNode}/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                access_token: accessToken,
                file_url: cleanMediaUrl,
                description: caption,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(`Facebook API Error: ${data.error?.message || response.statusText}`);
        }
        return data;
    } else {
        console.log(`[Facebook API] Posting photo to Facebook page via /${targetNode}/photos...`);
        const response = await fetch(`${FACEBOOK_GRAPH_URL}/${targetNode}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                access_token: accessToken,
                url: cleanMediaUrl,
                caption: caption,
                message: caption,
                published: true,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(`Facebook API Error: ${data.error?.message || response.statusText}`);
        }
        return data;
    }
}

/**
 * 3. Instagram Posting (Upgraded with REELS support, Inline Polling & Rate Limit Resilience)
 * NOTE: All polling is done inline (awaited). Fire-and-forget background loops do NOT work
 * on serverless platforms like Vercel — the function context is killed when the response returns.
 */
export async function postToInstagram(accessToken: string, pageId: string, mediaUrl: string, caption: string, type: string = 'image'): Promise<any> {
    // 1. Get IG Account ID
    const igAccountRes = await fetchWithRetry(`${FACEBOOK_GRAPH_URL}/${pageId}?fields=instagram_business_account&access_token=${accessToken}`, {});
    const igAccountData = await igAccountRes.json();
    if (igAccountData.error || !igAccountData.instagram_business_account?.id) {
        throw new Error(`Failed to get IG Account ID: ${igAccountData.error?.message || 'Page not connected to IG'}`);
    }
    const igAccountId = igAccountData.instagram_business_account.id;

    // Enforce Instagram's strict 2200 character limit
    let safeCaption = caption || '';
    if (safeCaption.length > 2190) {
        safeCaption = safeCaption.substring(0, 2187) + '...';
    }

    // 2. Detect Media Type
    const isVideo = type === 'video' || !!mediaUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)(\?|$)/) || mediaUrl.includes('/video/');
    let cleanMediaUrl = mediaUrl;
    if (cleanMediaUrl.includes('r2.dev/adrolls-storage/')) {
        cleanMediaUrl = cleanMediaUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/');
    }

    const mediaPayload: any = {
        caption: safeCaption,
        access_token: accessToken,
    };

    if (isVideo) {
        mediaPayload.video_url = cleanMediaUrl;
        mediaPayload.media_type = 'REELS'; // Meta Graph API require REELS for video posts
    } else {
        mediaPayload.image_url = cleanMediaUrl;
    }

    // 3. Create Media Container
    console.log(`[Instagram API] Creating IG ${isVideo ? 'REELS' : 'IMAGE'} container...`);
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

    // 4. POLL STATUS INLINE — must be awaited, NOT fire-and-forget
    // Videos (Reels) typically take 30-90s to process on Meta's servers.
    // Images are usually instant but we poll a few times to be safe.
    const maxAttempts = isVideo ? 30 : 8;       // Videos: up to ~150s, Images: up to ~16s
    const pollInterval = isVideo ? 5000 : 2000;  // Videos: 5s between polls, Images: 2s
    let status = 'IN_PROGRESS';
    let attempts = 0;
    let lastStatusDescription = '';

    console.log(`[Instagram API] Polling container ${creationId} status (max ${maxAttempts} attempts, ${pollInterval}ms interval)...`);

    while (status !== 'FINISHED' && status !== 'FINISHED_DOWNLOADING' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        try {
            const statusRes = await fetchWithRetry(`${FACEBOOK_GRAPH_URL}/${creationId}?fields=status_code,status_description&access_token=${accessToken}`, {});
            const statusData = await statusRes.json();
            
            if (statusData.status_code) {
                status = statusData.status_code;
                lastStatusDescription = statusData.status_description || '';
            } else if (!isVideo) {
                // If Meta doesn't return status_code for an image container, it is ready
                status = 'FINISHED';
            }

            if (status === 'ERROR') {
                throw new Error(`Instagram processing failed: ${lastStatusDescription || 'Unknown Meta processing error'}`);
            }

            if (status === 'FINISHED' || status === 'FINISHED_DOWNLOADING') {
                console.log(`[Instagram API] Container ${creationId} ready after ${attempts + 1} polls.`);
                break;
            }
        } catch (pollErr: any) {
            if (pollErr.message?.includes('Instagram processing failed')) throw pollErr;
            if (!isVideo) { status = 'FINISHED'; break; }
        }
        attempts++;
        if (isVideo && attempts % 5 === 0) {
            console.log(`[Instagram API] Still waiting for Reel processing... (${attempts}/${maxAttempts}, status: ${status})`);
        }
    }

    if (status !== 'FINISHED' && status !== 'FINISHED_DOWNLOADING') {
        throw new Error(`Instagram Reel processing timed out after ${attempts * pollInterval / 1000}s. Container ${creationId} status: ${status}. ${lastStatusDescription}`);
    }

    // 5. Publish Container
    console.log(`[Instagram API] Publishing IG media container ${creationId}...`);
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
    console.log(`[Instagram API] Successfully published to Instagram! Post ID: ${publishData.id}`);
    return publishData;
}

/**
 * 3.5 LinkedIn Posting (Latest 2026 Versioned REST API with Robust Error Handling)
 * Includes required finalizeUpload step for videos and processing status polling.
 */
export async function postToLinkedin(accessToken: string, authorUrn: string, assetUrl: string, commentary: string, type: string = 'image'): Promise<any> {
    let urn = authorUrn || '';
    if (!urn.startsWith('urn:li:')) {
        urn = `urn:li:person:${urn}`;
    }

    const linkedinVersion = '202604';
    const linkedinHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Linkedin-Version': linkedinVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
    };
    let assetUrn = null;

    if (assetUrl) {
        const isVideo = type === 'video' || !!assetUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)(\?|$)/) || assetUrl.includes('/video/');

        try {
            console.log(`[LinkedIn API] Downloading media buffer from ${assetUrl}...`);
            const fileRes = await fetch(assetUrl);
            if (!fileRes.ok) throw new Error(`Failed to download media: ${fileRes.status} ${fileRes.statusText}`);
            const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
            const fileSizeBytes = fileBuffer.length;

            if (isVideo) {
                console.log(`[LinkedIn API] Initializing REST video upload (${fileSizeBytes} bytes)...`);
                const initRes = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
                    method: 'POST',
                    headers: linkedinHeaders,
                    body: JSON.stringify({
                        initializeUploadRequest: {
                            owner: urn,
                            fileSizeBytes: fileSizeBytes
                        }
                    })
                });
                const initData = await initRes.json();

                if (!initRes.ok || !initData.value?.video) {
                    const errMsg = initData.message || initData.serviceErrorCode || JSON.stringify(initData);
                    throw new Error(`LinkedIn video init failed (${initRes.status}): ${errMsg}`);
                }

                assetUrn = initData.value.video;
                const uploadInstructions = initData.value.uploadInstructions || [];
                const uploadToken = initData.value.uploadToken;

                // Upload all video chunks
                console.log(`[LinkedIn API] Uploading ${uploadInstructions.length} video chunk(s)...`);
                const uploadETags: string[] = [];
                for (let i = 0; i < uploadInstructions.length; i++) {
                    const instr = uploadInstructions[i];
                    const chunk = fileBuffer.subarray(instr.firstByte, instr.lastByte + 1);
                    const uploadRes = await fetch(instr.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: chunk
                    });
                    // Capture ETag from response for finalizeUpload
                    const etag = uploadRes.headers.get('etag') || '';
                    uploadETags.push(etag);
                    if (!uploadRes.ok) {
                        throw new Error(`LinkedIn video chunk ${i + 1}/${uploadInstructions.length} upload failed: ${uploadRes.status}`);
                    }
                }
                console.log(`[LinkedIn API] All video chunks uploaded. Calling finalizeUpload...`);

                // CRITICAL: Call finalizeUpload to complete the video upload
                const finalizeRes = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
                    method: 'POST',
                    headers: linkedinHeaders,
                    body: JSON.stringify({
                        finalizeUploadRequest: {
                            video: assetUrn,
                            uploadToken: uploadToken || undefined,
                            uploadedPartIds: uploadETags.length > 0 ? uploadETags : undefined
                        }
                    })
                });
                if (!finalizeRes.ok) {
                    const finalizeErr = await finalizeRes.json().catch(() => ({}));
                    console.warn(`[LinkedIn API] finalizeUpload returned ${finalizeRes.status}: ${JSON.stringify(finalizeErr)}`);
                    // Some LinkedIn API versions return 200 with empty body, some return 204
                    // Only fail if it's a clear error (4xx/5xx with error message)
                    if (finalizeRes.status >= 400) {
                        throw new Error(`LinkedIn finalizeUpload failed: ${finalizeErr.message || finalizeRes.status}`);
                    }
                }
                console.log(`[LinkedIn API] Video finalized. Polling for processing completion...`);

                // Poll for video processing completion (LinkedIn needs time to process)
                let videoReady = false;
                for (let poll = 0; poll < 20; poll++) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    try {
                        const statusRes = await fetch(`https://api.linkedin.com/rest/videos/${encodeURIComponent(assetUrn)}`, {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Linkedin-Version': linkedinVersion,
                                'X-Restli-Protocol-Version': '2.0.0',
                            }
                        });
                        if (statusRes.ok) {
                            const statusData = await statusRes.json();
                            const videoStatus = (statusData.status || '').toUpperCase();
                            console.log(`[LinkedIn API] Video status poll ${poll + 1}: ${videoStatus}`);
                            if (videoStatus === 'AVAILABLE' || videoStatus === 'PROCESSING_COMPLETE' || videoStatus === 'READY') {
                                videoReady = true;
                                break;
                            }
                            if (videoStatus === 'FAILED' || videoStatus === 'ERROR') {
                                throw new Error(`LinkedIn video processing failed: ${statusData.status}`);
                            }
                        } else if (statusRes.status === 404) {
                            // Some LinkedIn API versions don't support status polling — assume ready after finalize
                            console.log(`[LinkedIn API] Video status endpoint returned 404, assuming ready after finalize.`);
                            videoReady = true;
                            break;
                        }
                    } catch (pollErr: any) {
                        if (pollErr.message?.includes('processing failed')) throw pollErr;
                        // Network errors during polling — continue
                    }
                }

                if (!videoReady) {
                    console.warn(`[LinkedIn API] Video processing timed out after 100s, attempting to create post anyway...`);
                }

                console.log(`[LinkedIn API] Video upload complete! URN: ${assetUrn}`);
            } else {
                console.log(`[LinkedIn API] Initializing REST image upload...`);
                const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
                    method: 'POST',
                    headers: linkedinHeaders,
                    body: JSON.stringify({
                        initializeUploadRequest: { owner: urn }
                    })
                });
                const initData = await initRes.json();

                if (initRes.ok && initData.value?.image) {
                    assetUrn = initData.value.image;
                    const uploadUrl = initData.value.uploadUrl;
                    if (uploadUrl) {
                        await fetch(uploadUrl, {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'image/jpeg'
                            },
                            body: fileBuffer
                        });
                        console.log(`[LinkedIn API] Image binary uploaded successfully! URN: ${assetUrn}`);
                    }
                }
            }
        } catch (mediaErr: any) {
            console.error(`[LinkedIn API] Media attachment error: ${mediaErr.message}`);
            // For videos, this is critical — don't fall back to text-only
            if (type === 'video') {
                throw new Error(`LinkedIn video upload failed: ${mediaErr.message}`);
            }
            console.warn(`[LinkedIn API] Falling back to text-only post.`);
            assetUrn = null;
        }
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
    };

    if (assetUrn) {
        payload.content = {
            media: {
                id: assetUrn
            }
        };
    }

    console.log(`[LinkedIn API] Creating post${assetUrn ? ' with media' : ' (text only)'}...`);
    const response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: linkedinHeaders,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'LinkedIn API error' }));
        throw new Error(errorData.message || `LinkedIn error ${response.status}`);
    }

    const postId = response.headers.get('x-restli-id');
    console.log(`[LinkedIn API] Successfully published to LinkedIn! Post ID: ${postId}`);
    return { id: postId };
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

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let cachedLLMModel: string | null = null;
let lastLLMCacheFetchTime = 0;
const LLM_CACHE_TTL = 10000; // 10 seconds cache

async function getSuperAdminSelectedLLM(): Promise<string> {
    const now = Date.now();
    if (cachedLLMModel && (now - lastLLMCacheFetchTime < LLM_CACHE_TTL)) {
        return cachedLLMModel;
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('selected_text_llm')
            .eq('role', 'super_admin')
            .limit(1);

        if (!error && data && data.length > 0) {
            const val = data[0].selected_text_llm || 'gemini';
            cachedLLMModel = val;
            lastLLMCacheFetchTime = now;
            return val;
        } else if (error) {
            console.error("[LLM ROUTER] Supabase query error:", error);
        }
    } catch (err) {
        console.error("[LLM ROUTER] Failed to fetch super admin selected LLM:", err);
    }

    // Default fallback
    return cachedLLMModel || 'gemini';
}

export async function callDeepSeekWithUsage(prompt: string): Promise<{ text: string; promptTokens: number; completionTokens: number; modelName: string }> {
    const rawApiKey = process.env.DEEPSEEK_API_KEY || '';
    const apiKey = rawApiKey.replace(/^["']|["']$/g, '').trim();
    if (!apiKey) {
        throw new Error("DEEPSEEK_API_KEY environment variable is not set");
    }

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "deepseek-v4-flash",
            messages: [
                { role: "user", content: prompt }
            ],
            stream: false
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DeepSeek API error: ${response.statusText} - ${errText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const usage = data.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;

    return {
        text,
        promptTokens,
        completionTokens,
        modelName: "deepseek-v4-flash"
    };
}

export async function callGeminiWithUsage(prompt: string, imageUrls?: string[]): Promise<{ text: string; promptTokens: number; completionTokens: number; modelName: string }> {
    // 1. Multimodal queries (images/videos) MUST go to Gemini
    if (imageUrls && imageUrls.length > 0) {
        return callGeminiWithUsageOriginal(prompt, imageUrls);
    }

    // 2. Text-only queries: route based on super admin preference
    const selectedModel = await getSuperAdminSelectedLLM();
    if (selectedModel === 'deepseek') {
        try {
            console.log(`[LLM ROUTER] Routing text-only query to DeepSeek v4-flash`);
            return await callDeepSeekWithUsage(prompt);
        } catch (err: any) {
            console.warn(`[LLM ROUTER] DeepSeek failed, falling back to Gemini. Error: ${err.message}`);
            return callGeminiWithUsageOriginal(prompt, imageUrls);
        }
    }

    // Default to Gemini
    return callGeminiWithUsageOriginal(prompt, imageUrls);
}

export async function callGeminiWithUsageOriginal(prompt: string, imageUrls?: string[]): Promise<{ text: string; promptTokens: number; completionTokens: number; modelName: string }> {
    const rawKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    const geminiKey = rawKey.replace(/^["']|["']$/g, '').trim();
    const fileManager = new GoogleAIFileManager(geminiKey);
    const genAI = new GoogleGenerativeAI(geminiKey);
    
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
        const text = response.text();
        
        const usage = (response as any).usageMetadata || {};
        const promptTokens = (usage as any).promptTokenCount || 0;
        const completionTokens = (usage as any).candidatesTokenCount || 0;
        const modelName = (response as any).model || "gemini-3.5-flash";

        return { text, promptTokens, completionTokens, modelName };

    } catch (e: any) {
        console.error("[Gemini Native Error]", e);
        throw new Error(`Gemini Native Error: ${e.message}`);
    }
}

export async function callGemini(prompt: string, imageUrls?: string[]): Promise<string> {
    const res = await callGeminiWithUsage(prompt, imageUrls);
    return res.text;
}

/**
 * 6. Fetch Lead Forms List
 */
export async function fetchLeadForms(accessToken: string, pageId: string): Promise<any[]> {
    try {
        const response = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}/leadgen_forms?fields=id,name,status,leads_count,questions{id,label,key,type,options}&limit=100&access_token=${accessToken}`);
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
            let nextUrl = `${FACEBOOK_GRAPH_URL}/${form.id}/leads?fields=id,created_time,field_data,ad_id,ad_name,campaign_id&limit=200&access_token=${accessToken}`;
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
                            if (fn.includes('full_name') || fn.includes('fullname') || fn === 'name' || fn.includes('your_name') || fn.includes('your name')) name = fv
                            else if (fn.includes('first_name') || fn.includes('firstname') || fn.includes('first name')) firstName = fv
                            else if (fn.includes('last_name') || fn.includes('lastname') || fn.includes('last name')) lastName = fv
                            else if (fn.includes('email') || fn.includes('e-mail')) email = fv
                            else if (fn.includes('phone') || fn.includes('mobile') || fn.includes('contact') || fn.includes('whatsapp') || fn.includes('tel')) phone = fv
                            else customFields[field.name] = fv
                        })

                        if ((!name || name === 'Unknown') && (firstName || lastName)) {
                            name = `${firstName} ${lastName}`.trim()
                        }

                        if (!name || name === 'Unknown') {
                            if (email) {
                                name = email.split('@')[0]
                            } else if (phone) {
                                name = phone
                            } else {
                                name = 'Lead'
                            }
                        }

                        if (l.ad_id || l.ad_name) {
                            customFields.meta_ad_origin = {
                                ad_id: l.ad_id || '',
                                ad_name: l.ad_name || '',
                                campaign_id: l.campaign_id || '',
                                campaign_name: form.name || '',
                                headline: l.ad_name || form.name || '',
                                body: '',
                                image_url: '',
                                source_url: l.ad_id ? `https://www.facebook.com/ads/library/?id=${l.ad_id}` : 'https://www.facebook.com/ads/library/'
                            };
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
                            facebook_created_at: l.created_time,
                            campaign_id: l.campaign_id || null
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
    sourceUrl?: string,
    eventId?: string
) {
    if (!pixelId) return;
    const hashData = (data: string) => crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
    const cleanPhone = (phone: string) => phone.replace(/\D/g, ''); // Keep only digits

    const payload = {
        data: [{
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            event_id: eventId || undefined,
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