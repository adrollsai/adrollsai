// adrollsai/adrollsai/adrollsai-adrollsai-version3/utils/external-apis.ts

import crypto from 'crypto';

// NOTE: For Next.js App Router API Routes, the native 'fetch' works correctly 
// for binary operations like PUT/POST of ArrayBuffer/Blob on the server.

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const FACEBOOK_GRAPH_URL = "https://graph.facebook.com/v19.0";
const LINKEDIN_API_URL = "https://api.linkedin.com/v2";
const YOUTUBE_API_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Required for Auto-Blogger cron job

/**
 * 1. Kie.ai Image/Video Generation (Replacing n8n 'Code in JavaScript1' and 'HTTP Request2')
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
 * 2. Facebook Posting (Replacing n8n 'Social to FB' workflow)
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
 * 3. Instagram Posting (Replacing n8n 'Post to Instagram' workflow)
 * UPDATED: Includes status check loop to prevent "Media ID not available" error
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

    // --- NEW: WAIT FOR CONTAINER TO BE READY ---
    let attempts = 0;
    const maxAttempts = 10; // Wait up to ~20 seconds
    let isReady = false;

    while (attempts < maxAttempts) {
        // Wait 2 seconds between checks
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const statusRes = await fetch(`${FACEBOOK_GRAPH_URL}/${creationId}?fields=status_code&access_token=${accessToken}`);
        const statusData = await statusRes.json();
        
        if (statusData.status_code === 'FINISHED') {
            isReady = true;
            break;
        }
        if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
             throw new Error(`IG Media Processing Failed with status: ${statusData.status_code}`);
        }
        // If IN_PROGRESS, loop continues
        attempts++;
    }
    
    if (!isReady) {
        throw new Error("Instagram Media Processing Timed Out. Please try again later.");
    }
    // -------------------------------------------

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
 * 4. LinkedIn Posting (Replacing n8n 'Post to LinkedIn' workflow)
 */
export async function postToLinkedIn(accessToken: string, imageUrl: string, caption: string): Promise<any> {
    
    // 4.1 Get User URN
    const userinfoRes = await fetch(`${LINKEDIN_API_URL}/userinfo`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const userinfoData = await userinfoRes.json();
    if (!userinfoRes.ok || !userinfoData.sub) {
        throw new Error(`LinkedIn URN Error: ${userinfoData.message || userinfoRes.statusText}`);
    }
    const authorUrn = `urn:li:person:${userinfoData.sub}`;

    // 4.2 Register Upload
    const registerPayload = {
        registerUploadRequest: {
            recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
            owner: authorUrn,
            serviceRelationships: [{
                relationshipType: "OWNER",
                identifier: "urn:li:userGeneratedContent"
            }]
        }
    };
    const registerRes = await fetch(`${LINKEDIN_API_URL}/assets?action=registerUpload`, {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${accessToken}`, 
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(registerPayload)
    });
    const registerData = await registerRes.json();
    const uploadUrl = registerData.value?.uploadMechanism?.[
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ]?.uploadUrl;
    const asset = registerData.value?.asset;

    if (!registerRes.ok || !uploadUrl || !asset) {
        throw new Error(`LinkedIn Register Error: ${registerData.message || registerRes.statusText}`);
    }

    // 4.3 Download Image and Upload Binary
    const imageRes = await fetch(imageUrl);
    const imageBuffer = await imageRes.arrayBuffer(); // Get as ArrayBuffer for binary upload

    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': imageRes.headers.get('content-type') || 'application/octet-stream', 
        },
        body: imageBuffer 
    });

    if (!uploadRes.ok) {
        throw new Error(`LinkedIn Upload Error: ${uploadRes.statusText}`);
    }
    
    // 4.4 Create Post
    const postPayload = {
        author: authorUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
            "com.linkedin.ugc.ShareContent": {
                shareCommentary: { text: caption },
                shareMediaCategory: "IMAGE",
                media: [{
                    status: "READY",
                    description: { text: "Image" },
                    media: asset,
                    title: { text: "Shared Image" }
                }]
            }
        },
        visibility: {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        }
    };

    const postRes = await fetch(`${LINKEDIN_API_URL}/ugcPosts`, {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${accessToken}`, 
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(postPayload)
    });
    const postData = await postRes.json();
    if (!postRes.ok) {
        throw new Error(`LinkedIn Post Error: ${postData.message || postRes.statusText}`);
    }

    return postData;
}


/**
 * 5. YouTube Posting (Replacing n8n 'Post to YouTube' workflow)
 */
export async function postToYouTube(accessToken: string, videoUrl: string, title: string, description: string, privacy: string = 'public'): Promise<any> {
    
    // 5.1 Initiate Resumable Upload
    const snippet = { title: title, description: description };
    const status = { privacyStatus: privacy, selfDeclaredMadeForKids: false };

    const initiateRes = await fetch(`${YOUTUBE_API_URL}?uploadType=resumable&part=snippet,status`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-Upload-Content-Type': 'video/mp4',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ snippet, status })
    });

    if (!initiateRes.ok) {
        const text = await initiateRes.text();
        throw new Error(`YouTube Initiate Error: ${text}`);
    }

    const uploadUrl = initiateRes.headers.get('location');
    if (!uploadUrl) {
        throw new Error("YouTube did not return an upload URL.");
    }
    
    // 5.2 Download Video and Upload Binary
    const videoRes = await fetch(videoUrl);
    const videoBuffer = await videoRes.arrayBuffer(); // Get as ArrayBuffer for binary upload

    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': 'video/mp4',
        },
        body: videoBuffer
    });

    // YouTube responds with JSON on success
    const uploadData = await uploadRes.json();

    if (!uploadRes.ok) {
        const text = await uploadRes.text();
        throw new Error(`YouTube Upload Error: ${text}`);
    }
    
    return uploadData;
}

/**
 * 6. Gemini Blog Generation (Conceptual - Required for Auto-Blogger)
 */
export async function callGemini(prompt: string): Promise<string> {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured for Auto-Blogger.");
    
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
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
 * 7. Fetch Lead Forms List
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
 * 8. Fetch Facebook Leads from Lead Forms (CRM FEATURE)
 * Updated with pagination loop and optional formId filtering.
 */
export async function fetchFacebookLeads(accessToken: string, pageId: string, specificFormId?: string): Promise<any[]> {
    try {
        // 1. Get Lead Forms for the Page
        // Increased limit to 500 to catch more forms at once
        const formsRes = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}/leadgen_forms?fields=id,name&limit=500&access_token=${accessToken}`);
        const formsData = await formsRes.json();
        
        if (formsData.error) throw new Error(formsData.error.message);
        
        let formsToProcess = formsData.data || [];

        // FILTER: If user selected a specific form, only process that one
        if (specificFormId) {
            formsToProcess = formsToProcess.filter((f: any) => f.id === specificFormId);
        }

        const allLeads = [];

        // 2. Iterate Forms and Get Leads
        for (const form of formsToProcess) {
            // Initial request for this form's leads
            let nextUrl = `${FACEBOOK_GRAPH_URL}/${form.id}/leads?fields=id,created_time,field_data,ad_id,ad_name&limit=200&access_token=${accessToken}`;
            
            // PAGINATION LOOP: Keep fetching while there is a 'next' page
            while (nextUrl) {
                const leadsRes = await fetch(nextUrl);
                const leadsData = await leadsRes.json();
                
                if (leadsData.data && leadsData.data.length > 0) {
                    const formattedLeads = leadsData.data.map((l: any) => {
                        // Helper to safely extract values from the field_data array
                        const getField = (name: string) => l.field_data?.find((f: any) => f.name === name)?.values[0] || '';
                        
                        // Combine Ad Name + Form Name for clear source tracking
                        const sourceTag = l.ad_name 
                            ? `${l.ad_name} | ${form.name}` 
                            : form.name;

                        return {
                            facebook_lead_id: l.id,
                            name: getField('full_name') || getField('name') || 'Unknown',
                            email: getField('email') || '',
                            phone: getField('phone_number') || '',
                            source: 'Facebook',
                            ad_name: sourceTag, // This now contains the visible Form Name
                            created_at: l.created_time
                        };
                    });
                    allLeads.push(...formattedLeads);
                }

                // Update nextUrl for the next loop iteration (or null to stop)
                nextUrl = leadsData.paging?.next || null;
            }
        }
        return allLeads;
    } catch (e: any) {
        throw new Error(`FB Leads Sync Error: ${e.message}`);
    }
}

/**
 * 9. Send Facebook CAPI Event (CRM FEATURE)
 */
export async function sendCAPIEvent(accessToken: string, pixelId: string, eventName: string, userData: { email?: string, phone?: string }, value?: number) {
    if (!pixelId) return;

    // Helper to Hash Data (SHA256) required by Meta
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
 * 10. Fetch Facebook Pixels for Ad Account (NEW)
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

// ==========================================
//           WHATSAPP FUNCTIONS
// ==========================================

/**
 * 11. Send WhatsApp Message (Text)
 * Good for replying to users within the 24h window.
 */
export async function sendWhatsAppMessage(
    accessToken: string, 
    phoneNumberId: string, 
    to: string, 
    text: string
  ): Promise<any> {
      try {
          const response = await fetch(`${FACEBOOK_GRAPH_URL}/${phoneNumberId}/messages`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                  messaging_product: "whatsapp",
                  recipient_type: "individual",
                  to: to,
                  type: "text",
                  text: { 
                      preview_url: false,
                      body: text 
                  }
              }),
          });
  
          const data = await response.json();
          
          if (!response.ok) {
              // Log full error for debugging
              console.error("WhatsApp API Error Response:", JSON.stringify(data, null, 2));
              throw new Error(`WhatsApp API Error: ${data.error?.message || response.statusText}`);
          }
          
          return data;
      } catch (e: any) {
          throw new Error(`Failed to send WhatsApp message: ${e.message}`);
      }
  }
  
  /**
   * 12. Send WhatsApp Template (NEW)
   * USE THIS for the first message to a user.
   * Templates are the ONLY way to open a conversation with a customer
   * who hasn't messaged you first.
   * * @param templateName - The name of the approved template (e.g., "hello_world")
   * @param languageCode - The language code (default "en_US")
   */
  export async function sendWhatsAppTemplate(
    accessToken: string, 
    phoneNumberId: string, 
    to: string, 
    templateName: string, 
    languageCode: string = "en_US"
  ): Promise<any> {
      try {
          const response = await fetch(`${FACEBOOK_GRAPH_URL}/${phoneNumberId}/messages`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                  messaging_product: "whatsapp",
                  recipient_type: "individual",
                  to: to,
                  type: "template",
                  template: { 
                      name: templateName, 
                      language: { 
                          code: languageCode 
                      } 
                  }
              }),
          });
  
          const data = await response.json();
          
          if (!response.ok) {
               console.error("WhatsApp Template Error Response:", JSON.stringify(data, null, 2));
               // Specific error handling for test numbers
               if (data.error?.code === 133010) {
                   throw new Error("Meta Restriction (#133010): The recipient number is not in your Allowed Test Users list. Please verify it in the App Dashboard.");
               }
               throw new Error(`WhatsApp Template Error: ${data.error?.message || "Unknown error"}`);
          }
          
          return data;
      } catch (e: any) {
          throw new Error(e.message);
      }
  }