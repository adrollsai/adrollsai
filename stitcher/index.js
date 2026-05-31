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
    process.env.VAPID_SUBJECT || 'mailto:hello@adrolls.in',
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

        // Generate concat.txt
        const concatContent = localFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
        const concatTxtPath = path.join(tempDir, 'concat.txt');
        fs.writeFileSync(concatTxtPath, concatContent);

        // Run system FFmpeg cleanly
        const outputPath = path.join(tempDir, 'stitched.mp4');
        const cmd = `ffmpeg -nostdin -y -loglevel error -f concat -safe 0 -i "${concatTxtPath}" -c copy -movflags +faststart "${outputPath}"`;

        
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`[Stitcher] Server running on port ${PORT}`);
});
