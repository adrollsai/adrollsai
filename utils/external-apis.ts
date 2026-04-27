// adrollsai/adrollsai/adrollsai-adrollsai-bsi/utils/external-apis.ts

import crypto from 'crypto';

// NOTE: For Next.js App Router API Routes, the native 'fetch' works correctly 
// for binary operations like PUT/POST of ArrayBuffer/Blob on the server.

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const FACEBOOK_GRAPH_URL = "https://graph.facebook.com/v19.0";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Required for Auto-Blogger cron job

/**
 * 1. Kie.ai Image/Video Generation 
 */
export async function createKieTask(payload: any): Promise<{ taskId: string } | { error: string }> {
    if (!KIE_API_KEY) return { error: "KIE_API_KEY is not configured." }
    
    try {
        const response = await fetch(KIE_CREATE_TASK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KIE_API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            return { error: data.msg || data.error || `Kie AI Task creation failed with status ${response.status}` }
        }

        return { taskId: data.data.taskId }

    } catch (e: any) {
        return { error: `Network error: ${e.message}` }
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
 * 3. Instagram Posting 
 */
export async function postToInstagram(accessToken: string, pageId: string, imageUrl: string, caption: string): Promise<any> {
    // 3.1 Get IG Business Account ID
    const igAccountRes = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}?fields=instagram_business_account&access_token=${accessToken}`);
    const igAccountData = await igAccountRes.json();
    if (igAccountData.error || !igAccountData.instagram_business_account?.id) {
        throw new Error(`Failed to get IG Account ID: ${igAccountData.error?.message || 'Page not connected to IG'}`);
    }
    const igAccountId = igAccountData.instagram_business_account.id;

    // 3.2 Create Media Container
    const containerRes = await fetch(`${FACEBOOK_GRAPH_URL}/${igAccountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image_url: imageUrl,
            caption: caption,
            access_token: accessToken,
        }),
    });
    const containerData = await containerRes.json();
    if (containerData.error || !containerData.id) {
        throw new Error(`Failed to create IG media container: ${containerData.error?.message || 'Unknown Error'}`);
    }
    const creationId = containerData.id;

    // 3.3 Publish Media
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
 * 4. Kie.ai Gemini Chat API 
 * FIXED: Uses dynamic model routing in the URL path to prevent 404 errors.
 */
export async function generateKieChat(prompt: string, model: string = "gemini-3-flash"): Promise<string> {
    if (!KIE_API_KEY) throw new Error("KIE_API_KEY is not configured for Chat API.");
    
    // The endpoint must include the model name in the URL for Kie.ai
    const endpoint = `https://api.kie.ai/${model}/v1/chat/completions`;
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${KIE_API_KEY}`
        },
        body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }]
        })
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.choices?.[0]?.message?.content) {
        throw new Error(`Kie.ai Chat API Error: ${data.error?.message || response.statusText || 'Unknown Error'}`);
    }

    return data.choices[0].message.content;
}


/**
 * 5. Gemini Blog Generation (Conceptual - Required for Auto-Blogger)
 */
export async function callGemini(prompt: string): Promise<string> {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured for Auto-Blogger.");
    
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GEMINI_API_KEY
        },
        body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        })
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error(`Gemini API Error: ${data.error?.message || response.statusText}`);
    }

    return data.candidates[0].content.parts[0].text;
}

/**
 * 6. Fetch Lead Forms List
 * Returns a list of forms so the user can select one.
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
 * 7. Fetch Facebook Leads from Lead Forms (CRM FEATURE)
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
                
                if (leadsData.data && leadsData.data.length > 0) {
                    const formattedLeads = leadsData.data.map((l: any) => {
                        const getField = (name: string) => l.field_data?.find((f: any) => f.name === name)?.values[0] || '';
                        
                        const sourceTag = l.ad_name 
                            ? `${l.ad_name} | ${form.name}` 
                            : form.name;

                        return {
                            facebook_lead_id: l.id,
                            name: getField('full_name') || getField('name') || 'Unknown',
                            email: getField('email') || '',
                            phone: getField('phone_number') || '',
                            source: 'Facebook',
                            ad_name: sourceTag, 
                            created_at: l.created_time
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
 * 8. Send Facebook CAPI Event (CRM FEATURE)
 */
export async function sendCAPIEvent(accessToken: string, pixelId: string, eventName: string, userData: { email?: string, phone?: string }, value?: number) {
    if (!pixelId) return;

    const hashData = (data: string) => crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');

    const payload = {
        data: [{
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            user_data: {
                em: userData.email ? [hashData(userData.email)] : [],
                ph: userData.phone ? [hashData(userData.phone)] : [],
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
 * 9. Fetch Facebook Pixels for Ad Account (NEW)
 */
export async function fetchFacebookPixels(accessToken: string, adAccountId: string): Promise<any[]> {
    try {
        const response = await fetch(`${FACEBOOK_GRAPH_URL}/${adAccountId}/adspixels?fields=name,id&access_token=${accessToken}`);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error.message);
        }
        
        return data.data || [];
    } catch (e: any) {
        throw new Error(`Failed to fetch Pixels: ${e.message}`);
    }
}