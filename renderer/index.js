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

const { fork } = require('child_process');
const app = express();
app.use(express.json());

const renderTempDir = path.join(os.tmpdir(), 'adrolls_temp_renders');
if (!fs.existsSync(renderTempDir)) {
    fs.mkdirSync(renderTempDir, { recursive: true });
}

// Spawn separate static server child process to prevent single-process event loop blocking during renders
console.log(`[Renderer] Spawning separate static file server on port 8081...`);
const staticServerProcess = fork(path.resolve(__dirname, 'static-server.js'), [], {
    stdio: 'inherit'
});

// Clean up static server child process when main process exits
process.on('exit', () => {
    staticServerProcess.kill();
});
process.on('SIGINT', () => {
    staticServerProcess.kill();
    process.exit();
});
process.on('SIGTERM', () => {
    staticServerProcess.kill();
    process.exit();
});

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

function getMp4Duration(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const stats = fs.statSync(filePath);
    try {
        let buffer = Buffer.alloc(Math.min(256 * 1024, stats.size));
        fs.readSync(fd, buffer, 0, buffer.length, 0);
        
        let duration = parseMp4Buffer(buffer);
        if (duration !== null) return duration;
        
        if (stats.size > buffer.length) {
            const readSize = Math.min(512 * 1024, stats.size - buffer.length);
            buffer = Buffer.alloc(readSize);
            fs.readSync(fd, buffer, 0, buffer.length, stats.size - readSize);
            duration = parseMp4Buffer(buffer);
            if (duration !== null) return duration;
        }
    } catch (e) {
        console.error("Failed to parse MP4 duration:", e);
    } finally {
        fs.closeSync(fd);
    }
    return null;
}

function parseMp4Buffer(buffer) {
    let offset = 0;
    while (offset < buffer.length - 8) {
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        if (type === 'mvhd') {
            const version = buffer.readUInt8(offset + 8);
            let timescaleOffset = offset + 8 + 4;
            if (version === 1) {
                timescaleOffset += 16;
                const timescale = buffer.readUInt32BE(timescaleOffset);
                const durationHigh = buffer.readUInt32BE(timescaleOffset + 4);
                const durationLow = buffer.readUInt32BE(timescaleOffset + 8);
                const duration = (durationHigh * 4294967296) + durationLow;
                return duration / timescale;
            } else {
                timescaleOffset += 8;
                const timescale = buffer.readUInt32BE(timescaleOffset);
                const duration = buffer.readUInt32BE(timescaleOffset + 4);
                return duration / timescale;
            }
        }
        offset += 1;
    }
    return null;
}

/**
 * Downloads a file from a URL to a local destination path using a streaming pipeline with timeout and redirects.
 * Has both a per-socket idle timeout (60s) and an overall hard deadline (3 minutes).
 */
function downloadFile(urlStr, destPath, timeoutMs = 60000, maxRedirects = 5) {
    const http = require('http');
    const https = require('https');
    const { URL } = require('url');

    const HARD_DEADLINE_MS = 3 * 60 * 1000; // 3 minutes max for entire download

    return new Promise((resolve, reject) => {
        let redirectCount = 0;
        let settled = false;
        let activeRequest = null;

        function settle(err) {
            if (settled) return;
            settled = true;
            if (err) {
                fs.unlink(destPath, () => {});
                reject(err);
            } else {
                resolve();
            }
        }

        // Hard deadline: kill everything after 3 minutes no matter what
        const hardDeadline = setTimeout(() => {
            console.error(`[Download] HARD DEADLINE of ${HARD_DEADLINE_MS}ms exceeded for ${urlStr}`);
            if (activeRequest) {
                activeRequest.destroy();
            }
            settle(new Error(`Download hard deadline of ${HARD_DEADLINE_MS}ms exceeded for ${urlStr}`));
        }, HARD_DEADLINE_MS);
        
        function initiateDownload(currentUrl) {
            let parsedUrl;
            try {
                parsedUrl = new URL(currentUrl);
            } catch (err) {
                clearTimeout(hardDeadline);
                settle(new Error(`Invalid URL: ${currentUrl}`));
                return;
            }
            const client = parsedUrl.protocol === 'https:' ? https : http;
            
            const request = client.get(currentUrl, { timeout: timeoutMs }, (response) => {
                const statusCode = response.statusCode;
                
                // Handle Redirects
                if ([301, 302, 303, 307, 308].includes(statusCode)) {
                    const redirectUrl = response.headers.location;
                    if (!redirectUrl) {
                        clearTimeout(hardDeadline);
                        settle(new Error(`Redirect status ${statusCode} returned but no Location header provided.`));
                        return;
                    }
                    
                    redirectCount++;
                    if (redirectCount > maxRedirects) {
                        clearTimeout(hardDeadline);
                        settle(new Error(`Too many redirects (max: ${maxRedirects}) while downloading ${urlStr}`));
                        return;
                    }
                    
                    console.log(`[Download] Following redirect #${redirectCount} to: ${redirectUrl}`);
                    response.resume();
                    
                    // Resolve relative redirect location against the current URL
                    let resolvedUrl;
                    try {
                        resolvedUrl = new URL(redirectUrl, currentUrl).toString();
                    } catch (err) {
                        clearTimeout(hardDeadline);
                        settle(new Error(`Failed to resolve redirect URL ${redirectUrl} relative to ${currentUrl}`));
                        return;
                    }
                    initiateDownload(resolvedUrl);
                    return;
                }
                
                if (statusCode !== 200) {
                    clearTimeout(hardDeadline);
                    settle(new Error(`Failed to download remote file. Status: ${statusCode}`));
                    return;
                }

                console.log(`[Download] HTTP 200 received, streaming to disk...`);
                
                const fileStream = fs.createWriteStream(destPath);
                response.pipe(fileStream);
                
                fileStream.on('finish', () => {
                    clearTimeout(hardDeadline);
                    fileStream.close();
                    settle(null);
                });
                
                fileStream.on('error', (err) => {
                    clearTimeout(hardDeadline);
                    settle(err);
                });

                response.on('error', (err) => {
                    clearTimeout(hardDeadline);
                    settle(err);
                });
            });

            activeRequest = request;
            
            request.on('error', (err) => {
                clearTimeout(hardDeadline);
                settle(err);
            });
            
            request.on('timeout', () => {
                console.error(`[Download] Socket idle timeout of ${timeoutMs}ms exceeded for ${currentUrl}`);
                request.destroy();
                clearTimeout(hardDeadline);
                settle(new Error(`Socket idle timeout of ${timeoutMs}ms exceeded for ${currentUrl}`));
            });
        }
        
        initiateDownload(urlStr);
    });
}


// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', service: 'adrolls-remotion-renderer' });
});

// Process avatar video (trim & extract audio)
app.post('/process-avatar', async (req, res) => {
    const { avatarUrl, userId } = req.body;
    
    if (!avatarUrl || !userId) {
        return res.status(400).json({ error: 'Missing avatarUrl or userId' });
    }
    
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(avatarUrl).digest('hex');
    const videoKey = `generated/${userId}/trimmed_ref_${hash}.mp4`;
    const audioKey = `generated/${userId}/ref_audio_${hash}.mp3`;
    
    const videoUrl = `${R2_PUBLIC_URL}/adrolls-storage/${videoKey}`;
    const audioUrl = `${R2_PUBLIC_URL}/adrolls-storage/${audioKey}`;
    
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    
    // Check R2 cache
    try {
        await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: videoKey }));
        await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: audioKey }));
        console.log(`[Process Avatar] Cache hit for user ${userId}: video and audio found.`);
        return res.status(200).json({ success: true, videoUrl, audioUrl });
    } catch (e) {
        console.log(`[Process Avatar] Cache miss for user ${userId}. Processing video and audio...`);
    }
    
    const tempDir = path.join(os.tmpdir(), `avatar_proc_${userId}_${Date.now()}`);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const inputPath = path.join(tempDir, 'input.mp4');
        const trimmedPath = path.join(tempDir, 'output.mp4');
        const audioPath = path.join(tempDir, 'output.mp3');
        
        // 1. Download original video
        console.log(`[Process Avatar] Downloading: ${avatarUrl}`);
        await downloadFile(avatarUrl, inputPath);
        
        // 2. FFmpeg trim video & extract audio
        const { exec } = require('child_process');
        
        // Command to trim first 15 seconds
        const trimCmd = `ffmpeg -y -i "${inputPath}" -t 15 -c:v libx264 -c:a aac -preset superfast -movflags +faststart "${trimmedPath}"`;
        console.log(`[Process Avatar] Trimming video...`);
        await new Promise((resolve, reject) => {
            exec(trimCmd, (err, stdout, stderr) => {
                if (err) reject(new Error(`Video trim failed: ${stderr}`));
                else resolve();
            });
        });
        
        // Command to extract high-quality audio
        const audioCmd = `ffmpeg -y -i "${trimmedPath}" -vn -c:a libmp3lame -q:a 2 "${audioPath}"`;
        console.log(`[Process Avatar] Extracting audio...`);
        await new Promise((resolve, reject) => {
            exec(audioCmd, (err, stdout, stderr) => {
                if (err) reject(new Error(`Audio extraction failed: ${stderr}`));
                else resolve();
            });
        });
        
        // 3. Upload to R2
        console.log(`[Process Avatar] Uploading trimmed video to R2...`);
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: videoKey,
            Body: fs.readFileSync(trimmedPath),
            ContentType: 'video/mp4'
        }));
        
        console.log(`[Process Avatar] Uploading audio to R2...`);
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: audioKey,
            Body: fs.readFileSync(audioPath),
            ContentType: 'audio/mpeg'
        }));
        
        console.log(`[Process Avatar] Successfully processed and cached!`);
        return res.status(200).json({ success: true, videoUrl, audioUrl });
        
    } catch (err) {
        console.error(`[Process Avatar] Processing failed:`, err);
        return res.status(500).json({ error: `Avatar processing failed: ${err.message}` });
    } finally {
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (cleanupErr) {}
    }
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
            console.log(`[Renderer] Step 1: Fetching asset record from Supabase for: ${assetId}`);
            const { data: asset, error: assetError } = await supabase
                .from('assets')
                .select('*')
                .eq('id', assetId)
                .single();

            if (assetError || !asset) {
                throw new Error(`Asset ${assetId} not found in database. Error: ${assetError?.message || 'No data returned'}`);
            }
            assetRecord = asset;
            console.log(`[Renderer] Step 1 complete: Asset found, current status: ${asset.status}`);

            // 2. Set Status to 'Rendering'
            console.log(`[Renderer] Step 2: Updating asset status to 'Rendering'...`);
            await supabase
                .from('assets')
                .update({ status: 'Rendering' })
                .eq('id', assetId);

            console.log(`[Renderer] Step 2 complete: Asset status updated to 'Rendering' for: ${assetId}`);

            // 2.5 Download remote videoUrl locally
            console.log(`[Renderer] Step 3: Downloading remote video to local storage: ${videoUrl}`);
            const rawTempPath = path.join(renderTempDir, `raw_${assetId}_${Date.now()}.mp4`);
            await downloadFile(videoUrl, rawTempPath);
            console.log(`[Renderer] Step 3 complete: Video downloaded successfully to: ${rawTempPath}`);

            // Transcode the video using ffmpeg to make every frame a keyframe (GOP = 1)
            // This ensures frame-accurate, instantaneous seeks inside Chromium and completely resolves video stuttering/glitching!
            const isCloudRun = !!process.env.K_SERVICE;
            
            if (isCloudRun) {
                console.log(`[Renderer] Cloud Run environment detected. Skipping transcode step and using raw downloaded video directly.`);
                tempSourcePath = rawTempPath;
            } else {
                tempSourcePath = path.join(renderTempDir, `source_${assetId}_${Date.now()}.mp4`);
                console.log(`[Renderer] Local environment detected. Transcoding video to intra-frame-only (GOP=1) to prevent seek stutter...`);
                
                let ffmpegPath = 'ffmpeg';
                if (process.platform === 'win32') {
                    try {
                        ffmpegPath = require('ffmpeg-static');
                    } catch (e) {
                        console.log("[Renderer] ffmpeg-static require failed, falling back to 'ffmpeg'");
                    }
                }
                
                const transcodeCmd = `"${ffmpegPath}" -nostdin -y -loglevel error -fflags +genpts -i "${rawTempPath}" -vf "settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p" -af "asetpts=PTS-STARTPTS" -c:v libx264 -r 30 -g 30 -c:a aac -preset superfast -crf 18 "${tempSourcePath}"`;
                
                console.log(`[Renderer] Running transcode command: ${transcodeCmd}`);
                
                await new Promise((resolveTranscode, rejectTranscode) => {
                    const { exec } = require('child_process');
                    exec(transcodeCmd, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
                        if (err) {
                            console.error(`[Renderer] Transcode failed:`, err);
                            console.error(`[Renderer] Transcode stderr:`, stderr);
                            rejectTranscode(err);
                        } else {
                            console.log(`[Renderer] Transcode completed successfully!`);
                            resolveTranscode();
                        }
                    });
                });

                // Clean up the raw download file since we now have the transcoded version
                try {
                    if (fs.existsSync(rawTempPath)) {
                        fs.unlinkSync(rawTempPath);
                    }
                } catch (e) {}
            }

            // Format local path as a 127.0.0.1 HTTP URL for headless Chromium compatibility to bypass CORS / same-origin restrictions on file:// resources
            const finalInputVideoUrl = `http://127.0.0.1:8081/static/${path.basename(tempSourcePath)}`;
            console.log(`[Renderer] Selected video URL for Remotion Chromium (Cloud Run: ${isCloudRun}): ${finalInputVideoUrl}`);

            // 3. Detect Video Duration using local file path
            let duration = 30; // fallback
            try {
                const parsedDuration = getMp4Duration(tempSourcePath);
                if (parsedDuration !== null) {
                    duration = parsedDuration;
                    console.log(`[Renderer] Binary header probe succeeded on local file. Duration: ${duration} seconds.`);
                } else {
                    console.warn(`[Renderer] Binary header probe returned null. Using fallback 30s.`);
                }
            } catch (probeErr) {
                console.warn(`[Renderer] Binary header probe failed. Using fallback 30s.`, probeErr.message);
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
                inputProps: { videoUrl: finalInputVideoUrl, captions, effects, theme, profile },
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
                inputProps: { videoUrl: finalInputVideoUrl, captions, effects, theme, profile },
                concurrency: isCloudRun ? 2 : 1, // Use 2 parallel workers on Cloud Run to utilize both CPUs; 1 on local dev to avoid OOM
                chromiumOptions: {
                    gl: 'angle',
                    ignoreDefaultArgs: ['--mute-audio'],
                    args: [
                        '--no-sandbox', 
                        '--disable-setuid-sandbox', 
                        '--disable-dev-shm-usage',
                        '--allow-file-access-from-files'
                    ],
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
