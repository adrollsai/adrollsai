const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));
const supabaseAdmin = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY);

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${envConfig.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: envConfig.R2_ACCESS_KEY_ID,
        secretAccessKey: envConfig.R2_SECRET_ACCESS_KEY
    }
});

const assetId = "884bd839-900a-4556-b7dc-6222cd6a8e75";
const videoUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/grok_gnr_1785065022289.mp4";
const audioUrl = "https://file.aiquickdraw.com/as/0a237c5f3b4c85a81a35e6e17bc21a2d_1785065074672.wav";

async function main() {
    console.log("=== Downloading Video & Audio ===");
    const tempDir = path.join(os.tmpdir(), `mix_gnr_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const videoPath = path.join(tempDir, 'video.mp4');
    const audioPath = path.join(tempDir, 'audio.wav');
    const outputPath = path.join(tempDir, 'out.mp4');

    const vRes = await fetch(videoUrl);
    fs.writeFileSync(videoPath, Buffer.from(await vRes.arrayBuffer()));

    const aRes = await fetch(audioUrl);
    fs.writeFileSync(audioPath, Buffer.from(await aRes.arrayBuffer()));

    const ffmpegBinary = path.join(
        process.cwd(), 
        'node_modules', 
        'ffmpeg-static', 
        os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    );

    console.log("=== Mixing Audio with 10% Background Music Ducking ===");
    const mixCmd = `"${ffmpegBinary}" -y -i "${videoPath}" -i "${audioPath}" -filter_complex "[0:a]volume=0.1[bg];[1:a]volume=1.0[vo];[bg][vo]amix=inputs=2:duration=first[aout]" -map 0:v:0 -map "[aout]" -c:v copy -c:a aac -shortest -movflags +faststart "${outputPath}"`;
    execSync(mixCmd);

    console.log("=== Uploading to R2 ===");
    const key = `generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/grok_gnr_1785065022289.mp4`;
    const buf = fs.readFileSync(outputPath);

    await r2.send(new PutObjectCommand({
        Bucket: 'adrolls-storage',
        Key: key,
        Body: buf,
        ContentType: 'video/mp4'
    }));

    const finalR2Url = `https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/${key}`;
    console.log("Final R2 Video URL:", finalR2Url);

    console.log("=== Updating Supabase Asset Record ===");
    const { data: updatedAsset, error } = await supabaseAdmin
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
        console.log("SUCCESS! Updated asset in Supabase!");
        console.log("Asset ID:", updatedAsset.id);
        console.log("Status:", updatedAsset.status);
        console.log("URL:", updatedAsset.url);
    }

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
}

main().catch(console.error);
