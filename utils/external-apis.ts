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