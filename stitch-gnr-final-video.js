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

const assetId = "884bd839-900a-4556-b7dc-6222cd6a8e75";
const userId = "42d2e0c5-4fe6-4738-8a9f-63f09be01f12";
const clipTaskIds = [
    '18126a4659789297734862469957cf76',
    '2ed33e7ba82850b148abd3011f24ea32',
    '0d93928bf420cbf5e16f123833720c19'
];
const audioUrl = "https://file.aiquickdraw.com/as/0a237c5f3b4c85a81a35e6e17bc21a2d_1785065074672.wav";

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
    console.log("=== STEP 1: Fetching Grok Clip URLs from Kie.ai ===");
    const clipUrls = [];
    for (let i = 0; i < clipTaskIds.length; i++) {
        const tid = clipTaskIds[i];
        console.log(`Fetching Clip ${i + 1} Task ${tid}...`);
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${tid}`, {
            headers: { 'Authorization': `Bearer ${kieApiKey}` }
        });
        const json = await res.json();
        const url = extractUrlFromKie(json);
        if (!url) throw new Error(`Could not extract video URL for task ${tid}!`);
        console.log(`Clip ${i + 1} URL:`, url);
        clipUrls.push(url);
    }

    console.log("\n=== STEP 2: Downloading Media Files ===");
    const tempDir = path.join(os.tmpdir(), `gnr_grok_vo_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const localClips = [];
    for (let i = 0; i < clipUrls.length; i++) {
        const p = path.join(tempDir, `clip${i + 1}.mp4`);
        const r = await fetch(clipUrls[i]);
        fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
        localClips.push(p);
    }

    const localAudioPath = path.join(tempDir, 'voiceover.wav');
    const ar = await fetch(audioUrl);
    fs.writeFileSync(localAudioPath, Buffer.from(await ar.arrayBuffer()));

    const concatListPath = path.join(tempDir, 'list.txt');
    fs.writeFileSync(concatListPath, localClips.map(cp => `file '${cp}'`).join('\n') + '\n');

    const concatPath = path.join(tempDir, 'concat.mp4');
    const finalPath = path.join(tempDir, 'final.mp4');

    const ffmpegBinary = path.join(
        process.cwd(), 
        'node_modules', 
        'ffmpeg-static', 
        os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    );

    console.log("=== STEP 3: Concatenating Clips ===");
    execSync(`"${ffmpegBinary}" -y -f concat -safe 0 -i "${concatListPath}" -c copy "${concatPath}"`);

    console.log("=== STEP 4: Mixing Voiceover (100% Vol) + Video BG Music (10% Vol) ===");
    const mixCmd = `"${ffmpegBinary}" -y -i "${concatPath}" -i "${localAudioPath}" -filter_complex "[0:a]volume=0.1[bg];[1:a]volume=1.0[vo];[bg][vo]amix=inputs=2:duration=first[aout]" -map 0:v:0 -map "[aout]" -c:v copy -c:a aac -shortest -movflags +faststart "${finalPath}"`;
    try {
        execSync(mixCmd);
    } catch (e) {
        console.warn("Complex audio mix fallback...", e.message);
        const fallbackCmd = `"${ffmpegBinary}" -y -i "${concatPath}" -i "${localAudioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -movflags +faststart "${finalPath}"`;
        execSync(fallbackCmd);
    }

    console.log("\n=== STEP 5: Uploading Finished Video to R2 ===");
    const timestamp = Date.now();
    const r2Key = `generated/${userId}/grok_gnr_vo_${timestamp}.mp4`;
    const finalR2Url = `${R2_PUBLIC_URL}/${r2Key}`;

    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: fs.readFileSync(finalPath),
        ContentType: 'video/mp4'
    }));

    console.log("Final R2 Video URL:", finalR2Url);

    console.log("\n=== STEP 6: Updating Asset in Supabase ===");
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
        console.log("SUCCESS! Updated GNR Homes asset in Supabase with voiceover!");
        console.log("Asset ID:", updatedAsset.id);
        console.log("Status:", updatedAsset.status);
        console.log("URL:", updatedAsset.url);
    }

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
}

main().catch(console.error);
