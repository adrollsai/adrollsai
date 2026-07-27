const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));
const supabaseAdmin = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY);
const kieApiKey = envConfig.KIE_API_KEY;

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

const assetId = "9c9a846f-7e0b-4616-afef-717c14a212e4";
const userId = "d838c956-1761-4bce-9d91-32f3abecc222";
const clipTaskIds = ["24032cde694b926962cdbb51cd635d8d", "b01b573af47076617c1d783b22e87fd6"];
const audioTaskId = "32ba1aa3982087fb8d769e0c60ee3038";

function extractUrlFromKie(info) {
    if (!info.data?.resultJson) return null;
    try {
        const parsed = JSON.parse(info.data.resultJson);
        const urls = parsed.resultUrls || parsed.result_urls || parsed.fullResultUrls || [parsed.url];
        const first = Array.isArray(urls) ? urls[0] : urls;
        if (first && typeof first === 'string' && first.startsWith('http')) {
            return first;
        }
    } catch (e) {}
    return null;
}

async function main() {
    console.log("=== STEP 1: Querying Kie.ai for Task URLs ===");
    const clipUrls = [];
    for (let i = 0; i < clipTaskIds.length; i++) {
        const tid = clipTaskIds[i];
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${tid}`, {
            headers: { 'Authorization': `Bearer ${kieApiKey}` }
        });
        const json = await res.json();
        const url = extractUrlFromKie(json);
        clipUrls.push(url);
    }

    const audioRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${audioTaskId}`, {
        headers: { 'Authorization': `Bearer ${kieApiKey}` }
    });
    const audioJson = await audioRes.json();
    const audioUrl = extractUrlFromKie(audioJson);

    console.log("=== STEP 2: Downloading Media Files ===");
    const tempDir = path.join(os.tmpdir(), `khushi_grok_fix_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const clip1Path = path.join(tempDir, 'clip1.mp4');
    const clip2Path = path.join(tempDir, 'clip2.mp4');
    const audioPath = path.join(tempDir, 'audio.wav');
    const concatListPath = path.join(tempDir, 'list.txt');
    const concatPath = path.join(tempDir, 'concat.mp4');
    const finalOutputPath = path.join(tempDir, 'final.mp4');

    const res1 = await fetch(clipUrls[0]);
    fs.writeFileSync(clip1Path, Buffer.from(await res1.arrayBuffer()));

    const res2 = await fetch(clipUrls[1]);
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

    console.log("=== STEP 3: Concatenating Clips ===");
    const concatCmd = `"${ffmpegBinary}" -y -f concat -safe 0 -i "${concatListPath}" -c copy "${concatPath}"`;
    execSync(concatCmd);

    console.log("=== STEP 4: Mixing Audio (Video BG Music at 10% + Voiceover at 100%) ===");
    const mixCmd = `"${ffmpegBinary}" -y -i "${concatPath}" -i "${audioPath}" -filter_complex "[0:a]volume=0.1[bg];[1:a]volume=1.0[vo];[bg][vo]amix=inputs=2:duration=first[aout]" -map 0:v:0 -map "[aout]" -c:v copy -c:a aac -shortest -movflags +faststart "${finalOutputPath}"`;
    try {
        execSync(mixCmd);
    } catch (e) {
        const fallbackCmd = `"${ffmpegBinary}" -y -i "${concatPath}" -i "${audioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -movflags +faststart "${finalOutputPath}"`;
        execSync(fallbackCmd);
    }

    console.log("=== STEP 5: Uploading Final Video to R2 ===");
    const finalBuffer = fs.readFileSync(finalOutputPath);
    const timestamp = Date.now();
    const r2Key = `generated/${userId}/grok_khushi_${timestamp}.mp4`;
    const finalR2Url = `${R2_PUBLIC_URL}/${r2Key}`;

    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: finalBuffer,
        ContentType: 'video/mp4'
    }));

    console.log("SUCCESS: Final R2 Video URL:", finalR2Url);

    console.log("=== STEP 6: Updating Supabase Asset Record ===");
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
        console.error("Error updating asset in Supabase:", error);
    } else {
        console.log("SUCCESSFULLY UPDATED ASSET!");
        console.log("Asset ID:", updatedAsset.id);
        console.log("Status:", updatedAsset.status);
        console.log("URL:", updatedAsset.url);
    }

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
}

main().catch(console.error);
