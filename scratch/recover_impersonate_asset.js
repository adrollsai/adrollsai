const { createClient } = require('@supabase/supabase-js');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing required credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

async function runRecovery() {
    const targetUserId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
    const failedAssetId = '9866c8bb-3c25-4122-bc78-d43aca7ba133';
    
    const clips = [
        'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/scene_0_1779973326261.mp4',
        'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/scene_1_1779973096736.mp4'
    ];

    console.log(`=== Recovering Asset ${failedAssetId} for User ${targetUserId} ===`);
    
    const tempDir = path.join(os.tmpdir(), `recover_${failedAssetId}`);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const localFiles = [];
    try {
        // 1. Download clips
        for (let i = 0; i < clips.length; i++) {
            const clipUrl = clips[i];
            const localPath = path.join(tempDir, `scene_${i}.mp4`);
            console.log(`Downloading scene ${i} from ${clipUrl}...`);
            const response = await fetch(clipUrl);
            if (!response.ok) {
                throw new Error(`Failed to download clip ${i} from ${clipUrl}`);
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(localPath, buffer);
            localFiles.push(localPath);
            console.log(`Scene ${i} downloaded to ${localPath}`);
        }

        // 2. Generate concat.txt
        const concatContent = localFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
        const concatTxtPath = path.join(tempDir, 'concat.txt');
        fs.writeFileSync(concatTxtPath, concatContent);
        console.log(`concat.txt written to ${concatTxtPath}`);

        // 3. Stitch with FFmpeg
        const outputPath = path.join(tempDir, 'stitched.mp4');
        const ffmpegBinary = path.join(
            process.cwd(), 
            'node_modules', 
            'ffmpeg-static', 
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        
        const cmd = `"${ffmpegBinary}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -c copy "${outputPath}"`;
        console.log(`Running FFmpeg: ${cmd}`);
        
        await new Promise((resolve, reject) => {
            exec(cmd, (execErr, stdout, stderr) => {
                if (execErr) {
                    console.error("FFmpeg execution error:", execErr);
                    console.error(stderr);
                    reject(execErr);
                } else {
                    console.log("FFmpeg completed stitching successfully!");
                    resolve();
                }
            });
        });

        // 4. Upload stitched video to Cloudflare R2
        console.log("Uploading stitched video to R2...");
        const stitchedBuffer = fs.readFileSync(outputPath);
        const finalFileName = `adrolls-storage/generated/${targetUserId}/stitched_${Date.now()}.mp4`;
        
        await r2Client.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: finalFileName,
            Body: stitchedBuffer,
            ContentType: 'video/mp4'
        }));

        const persistedUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
        console.log(`Successfully uploaded recovered stitched video to R2: ${persistedUrl}`);

        // 5. Update database asset record
        console.log(`Updating asset ${failedAssetId} status to Draft and setting URL in database...`);
        const { data: updatedAsset, error: updateErr } = await supabase
            .from('assets')
            .update({
                url: persistedUrl,
                status: 'Draft',
                metadata: {} // Clear any error metadata
            })
            .eq('id', failedAssetId)
            .select()
            .single();

        if (updateErr) {
            console.error("Error updating asset in database:", updateErr);
        } else {
            console.log("=== Recovery Successful! Asset restored in DB ===");
            console.log(JSON.stringify(updatedAsset, null, 2));
        }

        // 6. Delete the video_tasks records since they are completed and fully stitched
        console.log("Cleaning up completed video tasks from DB...");
        const { error: deleteErr } = await supabase
            .from('video_tasks')
            .delete()
            .eq('asset_id', failedAssetId);
            
        if (deleteErr) {
            console.error("Failed to clean up video_tasks:", deleteErr);
        } else {
            console.log("Video tasks cleaned up successfully.");
        }

    } catch (e) {
        console.error("Recovery failed with error:", e);
    } finally {
        // Cleanup temp files
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log("Cleaned up temporary download directory.");
        } catch (cleanupErr) {
            console.error("Error cleaning up temp directory:", cleanupErr);
        }
    }
}

runRecovery().catch(console.error);
