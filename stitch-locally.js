const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

const r2 = new S3Client({
    region: 'auto',
    endpoint: envConfig.R2_ENDPOINT ? envConfig.R2_ENDPOINT.replace(/\/adrolls-storage$/, '') : `https://${envConfig.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: envConfig.R2_ACCESS_KEY_ID,
        secretAccessKey: envConfig.R2_SECRET_ACCESS_KEY
    }
});
const R2_BUCKET = envConfig.R2_BUCKET_NAME || 'adrolls-storage';
const R2_PUBLIC_URL = envConfig.NEXT_PUBLIC_R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';

const assetId = "34d99817-0cbd-4971-9aeb-8323f0e90321";
const clip1Url = "https://tempfile.aiquickdraw.com/ggg/users/64a2dde5-9ef7-4fa7-8ad2-d0a127091d19/generated/034db417-19b3-4638-b10c-567414fdb5a6/generated_video.mp4";
const clip2Url = "https://tempfile.aiquickdraw.com/ggg/users/fbeb2f7d-da00-4aea-b292-3e6a444f89d9/generated/4357f587-f798-4a8b-a745-72740ac25b21/generated_video.mp4";
const audioUrl = "https://file.aiquickdraw.com/as/67a522534e60e131f77dc82504a60f71_1785056738407.wav";

async function main() {
    const tempDir = path.join(os.tmpdir(), `local_stitch_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    console.log("=== STEP 1: Downloading Clips and Audio ===");
    const clip1Path = path.join(tempDir, 'clip1.mp4');
    const clip2Path = path.join(tempDir, 'clip2.mp4');
    const audioPath = path.join(tempDir, 'audio.wav');
    const concatListPath = path.join(tempDir, 'list.txt');
    const concatenatedPath = path.join(tempDir, 'concat.mp4');
    const finalOutputPath = path.join(tempDir, 'final.mp4');

    const res1 = await fetch(clip1Url);
    fs.writeFileSync(clip1Path, Buffer.from(await res1.arrayBuffer()));

    const res2 = await fetch(clip2Url);
    fs.writeFileSync(clip2Path, Buffer.from(await res2.arrayBuffer()));

    const resAudio = await fetch(audioUrl);
    fs.writeFileSync(audioPath, Buffer.from(await resAudio.arrayBuffer()));

    fs.writeFileSync(concatListPath, `file '${clip1Path}'\nfile '${clip2Path}'\n`);

    const ffmpegBinary = path.join(
        process.cwd(), 
        'node_modules', 
        'ffmpeg-static', 
        os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    );

    console.log("=== STEP 2: Concatenating Clips with FFmpeg ===");
    // Concat video clips
    const concatCmd = `"${ffmpegBinary}" -y -f concat -safe 0 -i "${concatListPath}" -c copy "${concatenatedPath}"`;
    execSync(concatCmd);

    console.log("=== STEP 3: Merging Audio with FFmpeg ===");
    // Merge audio over concatenated video
    const mergeCmd = `"${ffmpegBinary}" -y -i "${concatenatedPath}" -i "${audioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -movflags +faststart "${finalOutputPath}"`;
    execSync(mergeCmd);

    console.log("=== STEP 4: Uploading Final Video to Cloudflare R2 ===");
    const finalBuffer = fs.readFileSync(finalOutputPath);
    const r2Key = `generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/grok_final_${Date.now()}.mp4`;

    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: finalBuffer,
        ContentType: 'video/mp4'
    }));

    const finalR2Url = `${R2_PUBLIC_URL}/adrolls-storage/${r2Key}`;
    console.log("SUCCESS: Final R2 Video URL:", finalR2Url);

    console.log("=== STEP 5: Updating Supabase Asset Record ===");
    const { data: asset, error } = await supabaseAdmin
        .from('assets')
        .update({
            url: finalR2Url,
            status: 'Draft'
        })
        .eq('id', assetId)
        .select()
        .single();

    if (error) {
        console.error("Error updating asset:", error);
    } else {
        console.log("SUCCESSFULLY UPDATED ASSET!");
        console.log("ID:", asset.id);
        console.log("Status:", asset.status);
        console.log("URL:", asset.url);
    }

    // Clean up
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
}

main().catch(console.error);
