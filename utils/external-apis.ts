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
 * Helper to fetch with retry logic for rate limits (429)
 */
async function fetchWithRetry(url: string, options: any, maxRetries = 3): Promise<Response> {
    let retries = 0;
    while (retries < maxRetries) {
        const response = await fetch(url, options);
        if (response.status === 429) {
            const waitTime = Math.pow(2, retries) * 1000 + Math.random() * 500;
            console.log(`[Rate Limit] Hit 429, retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            retries++;
            continue;
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
 * 3. Instagram Posting (Upgraded with Polling & Video Support)
 */
export async function postToInstagram(accessToken: string, pageId: string, mediaUrl: string, caption: string): Promise<any> {
    // 1. Get IG Account ID
    const igAccountRes = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}?fields=instagram_business_account&access_token=${accessToken}`);
    const igAccountData = await igAccountRes.json();
    if (igAccountData.error || !igAccountData.instagram_business_account?.id) {
        throw new Error(`Failed to get IG Account ID: ${igAccountData.error?.message || 'Page not connected to IG'}`);
    }
    const igAccountId = igAccountData.instagram_business_account.id;

    // 2. Detect Media Type (Video vs Image)
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
    const containerRes = await fetch(`${FACEBOOK_GRAPH_URL}/${igAccountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mediaPayload),
    });
    const containerData = await containerRes.json();
    if (containerData.error || !containerData.id) {
        throw new Error(`Failed to create IG media container: ${containerData.error?.message || 'Unknown Error'}`);
    }
    const creationId = containerData.id;

    // 4. POLL STATUS (Crucial for Videos and High-Res Images)
    // We wait up to 60 seconds for processing to finish
    let status = 'IN_PROGRESS';
    let attempts = 0;
    while (status !== 'FINISHED' && attempts < 12) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
        const statusRes = await fetch(`${FACEBOOK_GRAPH_URL}/${creationId}?fields=status_code&access_token=${accessToken}`);
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

    // 5. Publish Container
    const publishRes = await fetch(`${FACEBOOK_GRAPH_URL}/${igAccountId}/media_publish`, {
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
 * 4. Kie.ai Chat API (Upgraded for Multimodal Vision)
 */
export async function generateKieChat(prompt: string, model: string = "gemini-3-flash", imageUrl?: string): Promise<string> {
    if (!KIE_API_KEY) throw new Error("KIE_API_KEY is not configured for Chat API.");
    const endpoint = `https://api.kie.ai/${model}/v1/chat/completions`;
    
    let messageContent: any = prompt;
    
    if (imageUrl) {
        messageContent = [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } }
        ];
    }
    
    const response = await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${KIE_API_KEY}`
        },
        body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: messageContent }]
        })
    });
    const data = await response.json();
    
    if (!response.ok || !data.choices?.[0]?.message?.content) {
        console.error("Kie.ai Error Detail:", JSON.stringify(data, null, 2));
        throw new Error(`Kie.ai Chat API Error: ${data.error?.message || response.statusText || 'Unknown Error'}`);
    }

    return data.choices[0].message.content;
}

/**
 * 5. Gemini Content Generation (Official Google Gemini API via SDK)
 * Upgraded to support multimodal vision (images)
 */
export async function callGemini(prompt: string, imageUrls?: string[]): Promise<string> {
    try {
        const content: any[] = [{ type: 'text', text: prompt }];
        
        if (imageUrls && imageUrls.length > 0) {
            for (const url of imageUrls) {
                if (url.startsWith('data:')) {
                    const [header, base64Data] = url.split(',');
                    const mimeType = header.split(':')[1].split(';')[0];
                    content.push({ 
                        type: 'image', 
                        image: Buffer.from(base64Data, 'base64'),
                        mimeType 
                    });
                } else {
                    try {
                        content.push({ 
                            type: 'image', 
                            image: new URL(url) 
                        });
                    } catch (e) {
                        console.error("Invalid image URL for Gemini:", url);
                    }
                }
            }
        }

        const { text } = await generateText({
            model: google('gemini-3-flash-preview'),
            messages: [{ role: 'user', content }],
        });
        return text;
    } catch (e: any) {
        throw new Error(`Gemini SDK Error: ${e.message}`);
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
                            else if (fn === 'phone_number' || fn === 'phone' || fn === 'mobile_number') phone = fv
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
    value?: number
) {
    if (!pixelId) return;
    const hashData = (data: string) => crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');

    const payload = {
        data: [{
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'system_generated',
            user_data: {
                em: userData.email ? [hashData(userData.email)] : [],
                ph: userData.phone ? [hashData(userData.phone)] : [],
                fn: userData.firstName ? [hashData(userData.firstName)] : [],
                ln: userData.lastName ? [hashData(userData.lastName)] : [],
                external_id: userData.externalId ? [hashData(userData.externalId)] : [],
            },
            custom_data: {
                currency: 'INR',
                value: value || 0
            }
        }],
        access_token: accessToken
    };
    try {
        await fetch(`${FACEBOOK_GRAPH_URL}/${pixelId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log(`CAPI Event '${eventName}' Sent.`);
    } catch (e) {
        console.error("CAPI Error:", e);
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
export async function createKieImageTask(prompt: string, model: string = "flux2/flex-text-to-image"): Promise<string> {
    if (!KIE_API_KEY) throw new Error("KIE_API_KEY is not configured.");
    const response = await fetchWithRetry(KIE_CREATE_TASK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KIE_API_KEY}` },
        body: JSON.stringify({ 
            model: model, 
            input: { 
                prompt: prompt,
                aspect_ratio: "1:1",
                resolution: "1K"
            } 
        })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.msg || data.error || "Image task failed");
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