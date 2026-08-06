import express from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import webpush from 'web-push';

const app = express();
app.use(express.json());

// Initialize Supabase Admin Client
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize R2 S3 Client
const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// Configure Web Push Notifications
webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:info@nobogent.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

async function sendPushNotification(userId, title, body, url = '/dashboard/crm', type = 'general') {
    console.log(`[PUSH] Dispatching push notification for User: ${userId}`);
    try {
        const { data: subscriptions } = await supabaseAdmin
            .from('push_subscriptions')
            .select('*')
            .or(`user_id.eq.${userId},catalog_owner_id.eq.${userId}`);

        if (!subscriptions || subscriptions.length === 0) {
            console.log(`[PUSH] FAILED: 0 subscriptions found.`);
            return;
        }

        const payload = JSON.stringify({ title, body, url, type });
        const options = { TTL: 86400, urgency: 'high' };

        const sendPromises = subscriptions.map(async (sub) => {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
            };
            try {
                await webpush.sendNotification(pushSubscription, payload, options);
                console.log(`[PUSH] Dispatched successfully!`);
            } catch (err) {
                console.error(`[PUSH] Error:`, err.statusCode || err.message);
                if (err.statusCode === 404 || err.statusCode === 410) {
                    await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
                }
            }
        });
        await Promise.allSettled(sendPromises);
    } catch (e) {
        console.error(`[PUSH] Native Error:`, e);
    }
}

app.post('/stitch', async (req, res) => {
    const { siblings, videoTask } = req.body;

    console.log(`[Stitcher] Received request to stitch ${siblings?.length} scenes for Asset ID: ${videoTask?.asset_id}`);

    if (!siblings || !videoTask || !videoTask.asset_id || !videoTask.user_id) {
        return res.status(400).json({ error: "Missing required payload fields." });
    }

    // Immediately respond with 202 Accepted so client/Vercel isn't blocked waiting
    res.status(202).json({ success: true, message: "Stitching process started asynchronously." });

    const tempDir = path.join(os.tmpdir(), `stitch_${videoTask.asset_id}`);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Sort siblings just in case
        siblings.sort((a, b) => a.current_index - b.current_index);

        const localFiles = [];
        for (let idx = 0; idx < siblings.length; idx++) {
            const sib = siblings[idx];
            const clipUrl = sib.last_successful_task_id;
            if (!clipUrl || !clipUrl.startsWith('http')) {
                throw new Error(`Invalid video URL for scene index ${idx}`);
            }
            const localPath = path.join(tempDir, `scene_${idx}.mp4`);
            
            console.log(`[Stitcher] Downloading Scene ${idx} from ${clipUrl}...`);
            const fileRes = await fetch(clipUrl);
            if (!fileRes.ok) {
                throw new Error(`Failed to download scene ${idx} from ${clipUrl}`);
            }
            const buffer = Buffer.from(await fileRes.arrayBuffer());
            fs.writeFileSync(localPath, buffer);
            localFiles.push(localPath);
        }

        // Check for voiceover audioUrl in asset metadata
        let localAudioPath = null;
        let voiceoverUrl = req.body.audioUrl;
        if (!voiceoverUrl && videoTask.asset_id) {
            const { data: assetData } = await supabaseAdmin.from('assets').select('metadata').eq('id', videoTask.asset_id).maybeSingle();
            if (assetData?.metadata?.audioUrl) {
                voiceoverUrl = assetData.metadata.audioUrl;
            }
        }

        if (voiceoverUrl && typeof voiceoverUrl === 'string' && voiceoverUrl.startsWith('http')) {
            try {
                const cleanAudioUrl = voiceoverUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/');
                console.log(`[Stitcher] Downloading voiceover audio for stitch: ${cleanAudioUrl}...`);
                const audioRes = await fetch(cleanAudioUrl);
                if (audioRes.ok) {
                    localAudioPath = path.join(tempDir, 'voiceover.mp3');
                    fs.writeFileSync(localAudioPath, Buffer.from(await audioRes.arrayBuffer()));
                }
            } catch (audErr) {
                console.warn(`[Stitcher] Failed to download voiceover audio:`, audErr.message);
            }
        }

        // Generate concat.txt
        const concatContent = localFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
        const concatTxtPath = path.join(tempDir, 'concat.txt');
        fs.writeFileSync(concatTxtPath, concatContent);

        // Run system FFmpeg cleanly
        const outputPath = path.join(tempDir, 'stitched.mp4');
        const cmd = localAudioPath
            ? `ffmpeg -nostdin -y -loglevel error -f concat -safe 0 -i "${concatTxtPath}" -i "${localAudioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -ar 48000 -ac 2 -shortest -movflags +faststart "${outputPath}"`
            : `ffmpeg -nostdin -y -loglevel error -f concat -safe 0 -i "${concatTxtPath}" -c copy -movflags +faststart "${outputPath}"`;

        
        console.log(`[Stitcher] Executing FFmpeg: ${cmd}`);
        
        await new Promise((resolvePromise, rejectPromise) => {
            exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr, stdout, stderr) => {
                if (execErr) {
                    console.error(`[Stitcher] FFmpeg error:`, execErr);
                    console.error(`[Stitcher] FFmpeg stderr:`, stderr);
                    rejectPromise(execErr);
                } else {
                    console.log(`[Stitcher] FFmpeg stdout:`, stdout);
                    resolvePromise();
                }
            });
        });

        // Upload final stitched file to R2
        console.log(`[Stitcher] Uploading final stitched.mp4 to Cloudflare R2...`);
        const stitchedBuffer = fs.readFileSync(outputPath);
        const finalFileName = `generated/${videoTask.user_id}/stitched_${Date.now()}.mp4`;
        
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: finalFileName,
            Body: stitchedBuffer,
            ContentType: 'video/mp4'
        }));
        
        const persistedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${finalFileName}`;
        console.log(`[Stitcher] Stitched video successfully uploaded: ${persistedUrl}`);

        // Update placeholder asset in Supabase
        await supabaseAdmin.from('assets').update({
            url: persistedUrl,
            status: 'Draft'
        }).eq('id', videoTask.asset_id);

        // Clean up database video_tasks records
        await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);

        // Send push notification
        await sendPushNotification(
            videoTask.user_id, 
            "🎬 30s Video Creative Ready!", 
            "Your 30-second stitched AI video ad has been generated successfully.", 
            "/dashboard/assets", 
            "asset_ready"
        );

    } catch (stitchErr) {
        console.error("[Stitcher] Stitching process failed:", stitchErr);
        // Mark asset as failed
        await supabaseAdmin.from('assets').update({ status: 'Failed' }).eq('id', videoTask.asset_id);
        await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);
    } finally {
        // Clean up temp directories
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
                console.log(`[Stitcher] Temp directory cleaned up: ${tempDir}`);
            }
        } catch (cleanupErr) {
            console.error(`[Stitcher] Cleanup failed:`, cleanupErr);
        }
    }
});

const FACEBOOK_GRAPH_URL = 'https://graph.facebook.com/v19.0';

async function postToFacebook(accessToken, mediaUrl, caption, type = 'image', pageId) {
    const isVideo = type === 'video' || !!mediaUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)(\?|$)/) || mediaUrl.includes('/video/');
    const targetNode = pageId || 'me';
    let cleanMediaUrl = mediaUrl;
    if (cleanMediaUrl.includes('.r2.dev/') && !cleanMediaUrl.includes('/adrolls-storage/')) {
        cleanMediaUrl = cleanMediaUrl.replace('.r2.dev/', '.r2.dev/adrolls-storage/');
    }

    const endpoint = isVideo 
        ? `${FACEBOOK_GRAPH_URL}/${targetNode}/videos` 
        : `${FACEBOOK_GRAPH_URL}/${targetNode}/photos`;
    
    const bodyObj = isVideo
        ? { access_token: accessToken, file_url: cleanMediaUrl, description: caption }
        : { access_token: accessToken, url: cleanMediaUrl, caption, message: caption, published: true };

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Facebook API Error: ${data.error?.message || res.statusText}`);
    return data;
}

async function postToInstagram(accessToken, pageId, mediaUrl, caption, type = 'image') {
    const igAccountRes = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}?fields=instagram_business_account&access_token=${accessToken}`);
    const igAccountData = await igAccountRes.json();
    if (igAccountData.error || !igAccountData.instagram_business_account?.id) {
        throw new Error(`Failed to get IG Account ID: ${igAccountData.error?.message || 'Page not connected to IG'}`);
    }
    const igAccountId = igAccountData.instagram_business_account.id;

    let safeCaption = caption || '';
    if (safeCaption.length > 2190) safeCaption = safeCaption.substring(0, 2187) + '...';

    const isVideo = type === 'video' || !!mediaUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)(\?|$)/) || mediaUrl.includes('/video/');
    let cleanMediaUrl = mediaUrl;
    if (cleanMediaUrl.includes('.r2.dev/') && !cleanMediaUrl.includes('/adrolls-storage/')) {
        cleanMediaUrl = cleanMediaUrl.replace('.r2.dev/', '.r2.dev/adrolls-storage/');
    }

    const mediaPayload = {
        caption: safeCaption,
        access_token: accessToken,
        [isVideo ? 'video_url' : 'image_url']: cleanMediaUrl,
        ...(isVideo ? { media_type: 'REELS' } : {})
    };

    console.log(`[Stitcher Worker] Creating IG ${isVideo ? 'REELS' : 'IMAGE'} container...`);
    const containerRes = await fetch(`${FACEBOOK_GRAPH_URL}/${igAccountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mediaPayload)
    });
    const containerData = await containerRes.json();
    if (containerData.error || !containerData.id) {
        throw new Error(`Failed to create IG media container: ${containerData.error?.message || 'Unknown Error'}`);
    }
    const creationId = containerData.id;

    let status = 'IN_PROGRESS';
    let attempts = 0;
    const maxAttempts = isVideo ? 25 : 6;
    const pollInterval = isVideo ? 5000 : 2000;

    while (status !== 'FINISHED' && status !== 'FINISHED_DOWNLOADING' && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, pollInterval));
        try {
            const statusRes = await fetch(`${FACEBOOK_GRAPH_URL}/${creationId}?fields=status_code,status_description&access_token=${accessToken}`);
            const statusData = await statusRes.json();
            if (statusData.status_code) {
                status = statusData.status_code;
            } else if (!isVideo) {
                status = 'FINISHED';
            }
            if (status === 'ERROR') {
                throw new Error(`Instagram processing failed: ${statusData.status_description || 'Meta processing error'}`);
            }
        } catch (pollErr) {
            if (!isVideo) status = 'FINISHED';
        }
        attempts++;
    }

    console.log(`[Stitcher Worker] Publishing IG media container ${creationId}...`);
    const publishRes = await fetch(`${FACEBOOK_GRAPH_URL}/${igAccountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId, access_token: accessToken })
    });
    const publishData = await publishRes.json();
    if (publishData.error) {
        throw new Error(`Failed to publish to Instagram: ${publishData.error?.message || 'Unknown Error'}`);
    }
    return publishData;
}

async function postToLinkedin(accessToken, authorUrn, assetUrl, commentary, type = 'image') {
    let urn = authorUrn || '';
    if (!urn.startsWith('urn:li:')) urn = `urn:li:person:${urn}`;

    const linkedinVersion = '202604';
    let assetUrn = null;

    if (assetUrl) {
        const isVideo = type === 'video' || !!assetUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)(\?|$)/) || assetUrl.includes('/video/');
        const fileRes = await fetch(assetUrl);
        const arrayBuffer = await fileRes.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);
        const fileSizeBytes = fileBuffer.length;

        if (isVideo) {
            const initRes = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Linkedin-Version': linkedinVersion,
                    'X-Restli-Protocol-Version': '2.0.0',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ initializeUploadRequest: { owner: urn, fileSizeBytes } })
            });
            const initData = await initRes.json();
            if (initRes.ok && initData.value?.video) {
                assetUrn = initData.value.video;
                const instructions = initData.value.uploadInstructions || [];
                for (const instr of instructions) {
                    const chunk = fileBuffer.subarray(instr.firstByte, instr.lastByte + 1);
                    await fetch(instr.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: chunk
                    });
                }
            }
        } else {
            const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Linkedin-Version': linkedinVersion,
                    'X-Restli-Protocol-Version': '2.0.0',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ initializeUploadRequest: { owner: urn } })
            });
            const initData = await initRes.json();
            if (initRes.ok && initData.value?.image) {
                assetUrn = initData.value.image;
                if (initData.value.uploadUrl) {
                    await fetch(initData.value.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'image/jpeg' },
                        body: fileBuffer
                    });
                }
            }
        }
    }

    const postPayload = {
        author: urn,
        commentary: commentary || '',
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        content: assetUrn ? { media: { id: assetUrn } } : undefined,
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false
    };

    const postRes = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Linkedin-Version': linkedinVersion,
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(postPayload)
    });

    const postId = postRes.headers.get('x-restli-id') || postRes.headers.get('location');
    return { id: postId || 'success', status: 'published' };
}

app.post('/publish-social', async (req, res) => {
    const { targetUserId, imageUrl, caption, type, platforms } = req.body;
    console.log(`[Stitcher Worker] Received async social broadcast request for user ${targetUserId} to platforms:`, platforms);

    if (!targetUserId || !imageUrl || !platforms || !Array.isArray(platforms)) {
        return res.status(400).json({ error: "Missing required payload fields." });
    }

    // Immediately respond with 202 Accepted so Vercel & UI return instant response
    res.status(202).json({ success: true, message: "Social broadcast queued in background Cloud Run worker." });

    // Execute background worker publishing on Cloud Run
    (async () => {
        try {
            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('selected_page_token, selected_page_id, linkedin_token, linkedin_id, linkedin_urn')
                .eq('id', targetUserId)
                .single();

            if (!profile) return console.error(`[Stitcher Worker] Profile not found for user ${targetUserId}`);

            const results = {};
            const promises = [];

            const sendToPlatform = async (platform, fn) => {
                try {
                    const r = await fn();
                    results[platform] = r?.status || 'success';
                } catch (err) {
                    console.error(`[Stitcher Worker] ${platform} publish error:`, err.message);
                    results[platform] = `Failed: ${err.message.substring(0, 150)}`;
                }
            };

            if (platforms.includes('facebook') && profile.selected_page_token) {
                promises.push(sendToPlatform('facebook', () => postToFacebook(profile.selected_page_token, imageUrl, caption, type, profile.selected_page_id)));
            }
            if (platforms.includes('instagram') && profile.selected_page_token && profile.selected_page_id) {
                promises.push(sendToPlatform('instagram', () => postToInstagram(profile.selected_page_token, profile.selected_page_id, imageUrl, caption, type)));
            }
            if (platforms.includes('linkedin') && profile.linkedin_token && profile.linkedin_id) {
                const authorUrn = profile.linkedin_urn || `urn:li:person:${profile.linkedin_id}`;
                promises.push(sendToPlatform('linkedin', () => postToLinkedin(profile.linkedin_token, authorUrn, imageUrl, caption, type)));
            }

            await Promise.allSettled(promises);

            const hasSuccess = Object.values(results).some(val => val === 'success' || val === 'scheduled' || val === 'published');
            if (hasSuccess) {
                await supabaseAdmin.from('posts').insert({
                    user_id: targetUserId,
                    title: 'Social Post',
                    content: caption || '',
                    image_url: imageUrl || null,
                    status: 'social_published'
                }).catch(e => console.error("[Stitcher Worker] Insert post error:", e));
            }

            const successCount = Object.values(results).filter(v => v === 'success' || v === 'scheduled' || v === 'published').length;
            await sendPushNotification(
                targetUserId,
                `📲 Social Broadcast Published!`,
                `Your media post has been published to ${successCount} platform(s) via background worker.`,
                "/dashboard/assets",
                "social_post"
            );
            console.log(`[Stitcher Worker] Social broadcast finished for ${targetUserId}. Results:`, results);

        } catch (bgErr) {
            console.error("[Stitcher Worker] Background social broadcast fatal error:", bgErr);
        }
    })();
});

app.post('/process-background-image', async (req, res) => {
    const { userId, propId, taskId, generatedCaption, placeholderId, batchId, propertyTitle, socialCaption } = req.body;
    console.log(`[Stitcher Worker] Received background image generation job for user ${userId}, taskId ${taskId}`);

    if (!userId || !taskId) {
        return res.status(400).json({ error: "Missing required payload fields." });
    }

    res.status(202).json({ success: true, message: "Image generation job queued on Cloud Run worker." });

    (async () => {
        try {
            let attempts = 0;
            let finalImageUrl = '';

            while (attempts < 35) {
                attempts++;
                await new Promise(r => setTimeout(r, 8000));
                
                const checkRes = await fetch(`https://api.kie.ai/v1/jobs/${taskId}`, {
                    headers: { 'Authorization': `Bearer ${process.env.KIE_API_KEY || '748a2ca6b7c6135d0c3a45eb36b6bd54'}` }
                }).catch(() => null);

                if (!checkRes) continue;
                const checkData = await checkRes.json().catch(() => ({}));
                const status = checkData.status || checkData.data?.status || checkData.data?.state;

                if (status === 'succeeded' || status === 'completed' || status === 'success') {
                    const result = checkData.result || checkData.data?.result || checkData.data;
                    finalImageUrl = result?.image_url || result?.output_url || result?.url || (typeof result === 'string' && result.startsWith('http') ? result : null);
                    if (finalImageUrl) break;
                } else if (status === 'failed' || status === 'error') {
                    console.error(`[Stitcher Worker] Image generation failed for taskId ${taskId}`);
                    if (placeholderId) {
                        await supabaseAdmin.from('assets').update({ status: 'Failed', caption: 'Error: Kie AI Generation failed' }).eq('id', placeholderId);
                    }
                    break;
                }
            }

            if (!finalImageUrl) {
                if (placeholderId) {
                    await supabaseAdmin.from('assets').update({ status: 'Failed', caption: 'Error: Generation Timed Out' }).eq('id', placeholderId);
                }
                return;
            }

            // Persist to R2
            let persistedUrl = finalImageUrl;
            try {
                const imgRes = await fetch(finalImageUrl);
                const rawBuffer = Buffer.from(await imgRes.arrayBuffer());
                const finalFileName = `generated/${userId}/${Date.now()}.jpg`;
                
                await r2.send(new PutObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: finalFileName,
                    Body: rawBuffer,
                    ContentType: 'image/jpeg'
                }));
                persistedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${finalFileName}`;
            } catch (r2Err) {
                console.error("[Stitcher Worker] R2 upload error:", r2Err);
            }

            // Finalize Asset in DB
            if (placeholderId) {
                await supabaseAdmin.from('assets').update({
                    url: persistedUrl,
                    status: 'Draft',
                    caption: generatedCaption || 'AI Generated Creative'
                }).eq('id', placeholderId);
            } else {
                await supabaseAdmin.from('assets').insert({
                    user_id: userId,
                    property_id: propId || null,
                    url: persistedUrl,
                    type: 'image',
                    status: 'Draft',
                    caption: generatedCaption || 'AI Generated Creative'
                });
            }

            // Send push notification
            await sendPushNotification(
                userId,
                `✨ Creative Ready: ${propertyTitle || 'New Design'}`,
                `Your requested AI design for ${propertyTitle || 'property'} is ready.`,
                "/dashboard/assets",
                "asset_ready"
            );

        } catch (err) {
            console.error("[Stitcher Worker] Background image worker fatal error:", err);
        }
    })();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`[Stitcher] Server running on port ${PORT}`);
});
