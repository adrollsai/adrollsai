require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const crypto = require('crypto');
const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const avatarUrl = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/character-bc63c065-9bcc-4793-bedc-f0960406425b-1780138785561.mp4";
const targetUserId = "bc63c065-9bcc-4793-bedc-f0960406425b";

async function getTrimmedReferenceVideo(avatarUrl, userId) {
    let hash = crypto.createHash('md5').update(avatarUrl).digest('hex');
    try {
        const headRes = await fetch(avatarUrl, { method: 'HEAD' });
        const contentLength = headRes.headers.get('content-length') || '';
        const lastModified = headRes.headers.get('last-modified') || '';
        const eTag = headRes.headers.get('etag') || '';
        hash = crypto.createHash('md5').update(`${avatarUrl}_${contentLength}_${lastModified}_${eTag}`).digest('hex');
        console.log(`[Trim Video] Dynamic cache hash generated from HEAD headers: ${hash}`);
    } catch (e) {
        console.warn(`[Trim Video] HEAD request failed, using fallback hash: ${hash}`);
    }
    
    const cacheKey = `generated/${userId}/trimmed_ref_${hash}.mp4`;
    const cachedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${cacheKey}`;
    
    try {
        await r2.send(new HeadObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey
        }));
        console.log(`[Trim Video Cache] Found cached trimmed reference video: ${cachedUrl}`);
        return cachedUrl;
    } catch (e) {
        console.log(`[Trim Video Cache] No cache found. Starting download and trim for: ${avatarUrl}`);
    }

    const tempDir = path.join(os.tmpdir(), `trim_${userId}_${Date.now()}`);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const inputPath = path.join(tempDir, 'input.mp4');
        const outputPath = path.join(tempDir, 'output.mp4');
        
        // 1. Download
        const res = await fetch(avatarUrl);
        if (!res.ok) throw new Error(`Failed to download reference video: ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(inputPath, buffer);
        
        // 2. Trim with FFmpeg
        const ffmpegBinary = path.join(
            process.cwd(), 
            'node_modules', 
            'ffmpeg-static', 
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        const cmd = `"${ffmpegBinary}" -y -i "${inputPath}" -t 14 -c:v libx264 -c:a aac -preset superfast -movflags +faststart "${outputPath}"`;
        
        await new Promise((resolve, reject) => {
            exec(cmd, (err, stdout, stderr) => {
                if (err) {
                    console.warn(`[Trim Video] Standard trim failed. Retrying with silent video (-an)...`);
                    const silentCmd = `"${ffmpegBinary}" -y -i "${inputPath}" -t 14 -c:v libx264 -an -preset superfast -movflags +faststart "${outputPath}"`;
                    exec(silentCmd, (silentErr) => {
                        if (silentErr) reject(silentErr);
                        else resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
        
        // 3. Upload to R2
        const trimmedBuffer = fs.readFileSync(outputPath);
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey,
            Body: trimmedBuffer,
            ContentType: 'video/mp4'
        }));
        
        console.log(`[Trim Video] Reference video successfully trimmed and uploaded: ${cachedUrl}`);
        return cachedUrl;
    } catch (err) {
        console.error("[Trim Video Error] Failed to trim, falling back to original URL:", err);
        return avatarUrl;
    } finally {
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (err) {}
    }
}

async function extractReferenceAudio(videoUrl, userId) {
    const cacheKey = `generated/${userId}/ref_audio_${crypto.createHash('md5').update(videoUrl).digest('hex')}.mp3`;
    const cachedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${cacheKey}`;
    
    try {
        await r2.send(new HeadObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey
        }));
        console.log(`[Extract Audio Cache] Found cached reference audio: ${cachedUrl}`);
        return cachedUrl;
    } catch (e) {
        console.log(`[Extract Audio Cache] No cache found. Starting download and audio extraction for: ${videoUrl}`);
    }

    const tempDir = path.join(os.tmpdir(), `audio_ext_${userId}_${Date.now()}`);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const inputPath = path.join(tempDir, 'input.mp4');
        const outputPath = path.join(tempDir, 'output.mp3');
        
        // 1. Download
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`Failed to download video: ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(inputPath, buffer);
        
        // 2. Extract audio with FFmpeg
        const ffmpegBinary = path.join(
            process.cwd(), 
            'node_modules', 
            'ffmpeg-static', 
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        const cmd = `"${ffmpegBinary}" -y -i "${inputPath}" -vn -c:a libmp3lame -q:a 2 "${outputPath}"`;
        
        await new Promise((resolve, reject) => {
            exec(cmd, (err) => {
                if (err) {
                    console.warn(`[Extract Audio] Audio extraction failed (likely no audio track). Generating silent MP3 fallback...`);
                    const silentAudioCmd = `"${ffmpegBinary}" -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 14 -c:a libmp3lame -q:a 2 "${outputPath}"`;
                    exec(silentAudioCmd, (silentErr) => {
                        if (silentErr) reject(silentErr);
                        else resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
        
        // 3. Upload to R2
        const audioBuffer = fs.readFileSync(outputPath);
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey,
            Body: audioBuffer,
            ContentType: 'audio/mpeg'
        }));
        
        console.log(`[Extract Audio] Reference audio successfully extracted and uploaded: ${cachedUrl}`);
        return cachedUrl;
    } catch (err) {
        console.error("[Extract Audio Error] Failed to extract audio, returning empty string:", err);
        return "";
    } finally {
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (err) {}
    }
}

async function run() {
    console.log("Debugging local generate trimming...");
    const trimmed = await getTrimmedReferenceVideo(avatarUrl, targetUserId);
    console.log("Trimmed result URL:", trimmed);
    const audio = await extractReferenceAudio(trimmed, targetUserId);
    console.log("Extracted audio result URL:", audio);
}

run();
