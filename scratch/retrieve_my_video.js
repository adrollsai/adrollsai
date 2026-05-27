const { createClient } = require('@supabase/supabase-js');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const kieApiKey = process.env.KIE_API_KEY;

const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'adrolls-storage';
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';

if (!supabaseUrl || !supabaseServiceKey || !kieApiKey) {
    console.error("Missing required credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function extractVideoUrl(checkData) {
    if (!checkData) return null;
    
    // Parse from nested data.resultJson or root resultJson
    const resultJson = checkData.resultJson || checkData.data?.resultJson;
    if (resultJson) {
        try {
            const parsed = JSON.parse(resultJson);
            const urls = parsed.resultUrls || parsed.result_urls || parsed.fullResultUrls || parsed.full_result_urls;
            if (Array.isArray(urls) && urls.length > 0 && urls[0].startsWith('http')) {
                return urls[0];
            }
            if (parsed.url && parsed.url.startsWith('http')) {
                return parsed.url;
            }
        } catch (e) {
            console.error("Error parsing resultJson:", e);
        }
    }
    
    const result = checkData.result || checkData.data?.result || checkData.data;
    if (result) {
        const url = result.video_url || result.videoUrl || result.output_url || result.outputUrl || result.url || result.imageUrl || result.image_url;
        if (url && url.startsWith('http')) return url;
        
        const urls = result.videoUrls || result.resultUrls || result.result_urls || result.fullResultUrls || result.full_result_urls;
        if (Array.isArray(urls) && urls.length > 0 && urls[0].startsWith('http')) return urls[0];
    }

    // Regex match fallback
    try {
        const jsonStr = JSON.stringify(checkData);
        const matches = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|mov|avi|webm)[^"]*)"/i);
        if (matches && matches.length > 1) {
            return matches[1];
        }
    } catch (e) {}

    return null;
}

async function retrieveAndStitch() {
    const clips = [
        { id: 'd3acfe7bed6840b582953611485f0827', index: 0 },
        { id: '09c738734185aabe2599d2334d7fa1ba', index: 1 }
    ];

    const targetUserId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
    const stuckAssetId = '393fe572-6b04-41cd-9bcf-e4bcc83c5b90';

    console.log("=== Querying Clips from Kie.ai ===");
    const clipUrls = [];

    for (const clip of clips) {
        console.log(`Querying task ID ${clip.id}...`);
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${clip.id}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${kieApiKey}` }
        });

        if (!res.ok) {
            console.error(`Failed to fetch task ${clip.id}`);
            return;
        }

        const checkData = await res.json();
        console.log(`Task ${clip.id} response state:`, JSON.stringify(checkData.status || checkData.data?.status || checkData.data?.state));
        const videoUrl = extractVideoUrl(checkData);
        if (!videoUrl) {
            console.error(`Could not extract video URL for task ${clip.id}. Full response:`, JSON.stringify(checkData));
            return;
        }

        console.log(`Extracted video URL for Scene ${clip.index + 1}: ${videoUrl}`);
        clipUrls.push({ url: videoUrl, index: clip.index });
    }

    console.log("\n=== Commencing Local Downloading & Stitching ===");
    const tempDir = path.join(os.tmpdir(), `retrieve_${stuckAssetId}`);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const localFiles = [];
    for (const clip of clipUrls) {
        const localPath = path.join(tempDir, `scene_${clip.index}.mp4`);
        console.log(`Downloading ${clip.url} to ${localPath}...`);
        const response = await fetch(clip.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(localPath, buffer);
        localFiles.push(localPath);
    }

    // Generate concat.txt
    const concatContent = localFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
    const concatTxtPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatTxtPath, concatContent);

    const outputPath = path.join(tempDir, 'stitched.mp4');
    const ffmpegBinary = path.join(
        process.cwd(), 
        'node_modules', 
        'ffmpeg-static', 
        os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    );
    const cmd = `"${ffmpegBinary}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -c copy "${outputPath}"`;

    console.log(`Running FFmpeg command: ${cmd}`);
    await new Promise((resolve, reject) => {
        exec(cmd, (execErr, stdout, stderr) => {
            if (execErr) {
                console.error("FFmpeg error:", execErr);
                reject(execErr);
            } else {
                resolve();
            }
        });
    });

    console.log("Stitching complete. Uploading stitched result to R2...");
    const stitchedBuffer = fs.readFileSync(outputPath);
    const finalFileName = `generated/${targetUserId}/stitched_recovered_${Date.now()}.mp4`;
    
    await r2Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: finalFileName,
        Body: stitchedBuffer,
        ContentType: 'video/mp4'
    }));

    const persistedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${finalFileName}`;
    console.log(`Stitched video successfully uploaded to R2: ${persistedUrl}`);

    console.log("Updating database asset in Supabase...");
    const { data: updatedAsset, error: updateErr } = await supabase
        .from('assets')
        .update({
            url: persistedUrl,
            status: 'Draft' // Turn into real asset
        })
        .eq('id', stuckAssetId)
        .select()
        .single();

    if (updateErr) {
        console.error("Error updating asset in Supabase:", updateErr);
    } else {
        console.log("=== Recovery Successful! ===");
        console.log(JSON.stringify(updatedAsset, null, 2));
    }

    // Cleanup temp files
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log("Cleaned up temp files.");
    } catch (e) {}
}

retrieveAndStitch();
