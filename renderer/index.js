const express = require('express');
const { bundle } = require('@remotion/bundler');
const { getCompositions, renderMedia } = require('@remotion/renderer');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const webpush = require('web-push');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');

// Load environment variables for local development
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Initialize Supabase Admin client
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Cloudflare R2 client
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

// Configure Web Push VAPID keys
if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:hello@adrolls.in',
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// Push notification sender
async function sendPushNotification(userId, title, body, url = '/dashboard/assets') {
    try {
        if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
            console.log(`[Push] Skipped (VAPID keys not configured).`);
            return;
        }

        const { data: subscriptions } = await supabase
            .from('push_subscriptions')
            .select('*')
            .or(`user_id.eq.${userId},catalog_owner_id.eq.${userId}`);

        if (!subscriptions || subscriptions.length === 0) {
            console.log(`[Push] No push subscriptions found for User: ${userId}`);
            return;
        }

        console.log(`[Push] Found ${subscriptions.length} subscription(s). Dispatching notification...`);
        const payload = JSON.stringify({ title, body, url, type: 'general' });
        const options = { TTL: 86400, urgency: 'high' };

        const promises = subscriptions.map(async (sub) => {
            try {
                await webpush.sendNotification({
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth }
                }, payload, options);
            } catch (err) {
                if (err.statusCode === 404 || err.statusCode === 410) {
                    await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                }
            }
        });
        await Promise.allSettled(promises);
    } catch (err) {
        console.error("[Push Error]", err);
    }
}

// Helper to probe video duration
const getVideoDuration = (url) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(url, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata.format.duration);
        });
    });
};

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', service: 'adrolls-remotion-renderer' });
});

// Primary asynchronous render route
app.post('/render', async (req, res) => {
    const { assetId, videoUrl, captions, effects = [], theme, profile = {} } = req.body;

    if (!assetId || !videoUrl || !captions || !theme) {
        return res.status(400).json({ error: 'Missing required parameters: assetId, videoUrl, captions, theme are required.' });
    }

    console.log(`[Renderer] Received render request for Asset ID: ${assetId}`);

    // Immediately respond with 202 Accepted to prevent Vercel/gateway timeouts
    res.status(202).json({
        success: true,
        message: 'Rendering process initiated successfully in the cloud background.'
    });

    // Start background execution
    (async () => {
        let assetRecord = null;
        let tempSourcePath = null;
        let outputLocation = null;
        try {
            // 1. Fetch Asset Record
            const { data: asset, error: assetError } = await supabase
                .from('assets')
                .select('*')
                .eq('id', assetId)
                .single();

            if (assetError || !asset) {
                throw new Error(`Asset ${assetId} not found in database.`);
            }
            assetRecord = asset;

            // 2. Set Status to 'Rendering'
            await supabase
                .from('assets')
                .update({ status: 'Rendering' })
                .eq('id', assetId);

            console.log(`[Renderer] Asset status updated to 'Rendering' for: ${assetId}`);

            // 2.5 Download remote videoUrl locally to prevent network seeking stutter during render
            console.log(`[Renderer] Downloading remote video to local storage: ${videoUrl}`);
            tempSourcePath = path.join(os.tmpdir(), `source_${assetId}_${Date.now()}.mp4`);
            const fetchRes = await fetch(videoUrl);
            if (!fetchRes.ok) {
                throw new Error(`Failed to download remote source video. HTTP status: ${fetchRes.status}`);
            }
            const buffer = await fetchRes.arrayBuffer();
            fs.writeFileSync(tempSourcePath, Buffer.from(buffer));
            console.log(`[Renderer] Video downloaded successfully to local path: ${tempSourcePath}`);

            // Format local path for headless Chromium compatibility
            const isWindows = process.platform === 'win32';
            const localVideoUrl = isWindows 
                ? `file:///${tempSourcePath.replace(/\\/g, '/')}` 
                : `file://${tempSourcePath}`;
            console.log(`[Renderer] Local video file URL for Chromium: ${localVideoUrl}`);

            // 3. Detect Video Duration using local file path
            let duration = 30; // fallback
            try {
                duration = await getVideoDuration(tempSourcePath);
                console.log(`[Renderer] Probe succeeded on local file. Duration: ${duration} seconds.`);
            } catch (probeErr) {
                console.warn(`[Renderer] Probe failed on local file. Using fallback 30s.`, probeErr.message);
            }

            // 4. Bundle composition
            console.log(`[Renderer] Starting compilation bundle...`);
            const bundleLocation = await bundle({
                entryPoint: path.resolve(__dirname, "../remotion/index.ts"),
                webpackOverride: (config) => config,
            });

            // 5. Query Composition and override duration
            console.log(`[Renderer] Retrieving composition configurations...`);
            const comps = await getCompositions(bundleLocation, {
                inputProps: { videoUrl: localVideoUrl, captions, effects, theme, profile },
            });

            const composition = comps.find((c) => c.id === "CaptionsComposition");
            if (!composition) {
                throw new Error("Remotion composition 'CaptionsComposition' was not registered.");
            }

            const fps = 30;
            const originalDurationFrames = Math.ceil(duration * fps);
            const outroDurationFrames = 4 * fps; // 4 seconds brand outro
            const totalDurationFrames = originalDurationFrames + outroDurationFrames;

            composition.durationInFrames = totalDurationFrames;

            // Define output path
            outputLocation = path.join(os.tmpdir(), `render_${assetId}_${Date.now()}.mp4`);
            console.log(`[Renderer] Executing renderMedia (${totalDurationFrames} frames at ${fps}fps) -> ${outputLocation}`);

            // 6. Execute Render
            await renderMedia({
                composition,
                serveUrl: bundleLocation,
                codec: "h264",
                outputLocation,
                inputProps: { videoUrl: localVideoUrl, captions, effects, theme, profile },
                chromiumOptions: {
                    gl: 'angle',
                    ignoreDefaultArgs: ['--mute-audio'],
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                },
                onProgress: ({ progress }) => {
                    console.log(`[Renderer] Render progress: ${Math.round(progress * 100)}%`);
                }
            });

            console.log(`[Renderer] Render media successfully compiled!`);

            // 7. Read and Upload file to Cloudflare R2
            console.log(`[Renderer] Uploading rendered file to Cloudflare R2...`);
            const fileBuffer = fs.readFileSync(outputLocation);
            const fileName = `rendered/${assetRecord.user_id}/video_${Date.now()}.mp4`;

            await r2.send(new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: fileName,
                Body: fileBuffer,
                ContentType: 'video/mp4'
            }));

            const finalUrl = `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`;
            console.log(`[Renderer] Upload complete! Final URL: ${finalUrl}`);

            // 8. Update Asset URL and status in Database
            const { error: dbUpdateError } = await supabase
                .from('assets')
                .update({
                    url: finalUrl,
                    status: 'Draft' // Done rendering, ready for user review/deployment
                })
                .eq('id', assetId);

            if (dbUpdateError) throw dbUpdateError;

            console.log(`[Renderer] Database updated successfully for asset: ${assetId}`);

            // 9. Send Success Notification
            await sendPushNotification(
                assetRecord.user_id,
                "AI Video Edit Completed! 🎬",
                "Your viral captions, custom branding, and transitions have been applied successfully.",
                '/dashboard/assets'
            );

        } catch (error) {
            console.error(`[Renderer] Error during background rendering for Asset ${assetId}:`, error);

            // Set Asset status to 'Failed'
            await supabase
                .from('assets')
                .update({ status: 'Failed' })
                .eq('id', assetId);

            // Notify user of failure
            if (assetRecord) {
                await sendPushNotification(
                    assetRecord.user_id,
                    "AI Video Rendering Failed ⚠️",
                    "We encountered an issue during video composition. Please try rendering again.",
                    '/dashboard/assets'
                );
            }
        } finally {
            // Clean up temporary local source file
            if (tempSourcePath) {
                try {
                    if (fs.existsSync(tempSourcePath)) {
                        fs.unlinkSync(tempSourcePath);
                        console.log(`[Renderer] Safely cleaned up local temp source video file.`);
                    }
                } catch (cleanupErr) {
                    console.warn(`[Renderer] Temp source video cleanup warning:`, cleanupErr.message);
                }
            }

            // Clean up temporary render output file
            if (outputLocation) {
                try {
                    if (fs.existsSync(outputLocation)) {
                        fs.unlinkSync(outputLocation);
                        console.log(`[Renderer] Safely cleaned up local temp render output video file.`);
                    }
                } catch (cleanupErr) {
                    console.warn(`[Renderer] Temp render output cleanup warning:`, cleanupErr.message);
                }
            }
        }
    })();
});

// Run server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Renderer Server] Microservice running and listening on port ${PORT}`);
});
