const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { renderMediaOnLambda, getRenderProgress } = require('@remotion/lambda');
const { speculateFunctionName } = require('@remotion/lambda-client');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));
process.env.AWS_ACCESS_KEY_ID = envConfig.REMOTION_AWS_ACCESS_KEY_ID || envConfig.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = envConfig.REMOTION_AWS_SECRET_ACCESS_KEY || envConfig.AWS_SECRET_ACCESS_KEY;
process.env.REMOTION_AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
process.env.REMOTION_AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;
const kieApiKey = envConfig.KIE_API_KEY;

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
const videoTaskIds = ["a8223c5f9b6e1f9500df498541becc1e", "c8c3493617c5a332cfe57024660ac097"];
const audioTaskId = "67a522534e60e131f77dc82504a60f71";

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
    console.log("=== STEP 1: Fetching Kie.ai Video Clips and Audio ===");
    
    // Fetch video clip URLs
    const clipUrls = [];
    for (let i = 0; i < videoTaskIds.length; i++) {
        const tid = videoTaskIds[i];
        console.log(`Querying Kie Video Task ${i + 1}: ${tid}...`);
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${tid}`, {
            headers: { 'Authorization': `Bearer ${kieApiKey}` }
        });
        const json = await res.json();
        console.log(`Video Task ${tid} State:`, json.data?.state);
        const url = extractUrlFromKie(json);
        if (!url) throw new Error(`Could not extract video URL for task ${tid}! JSON: ${JSON.stringify(json)}`);
        console.log(`Video Clip ${i + 1} URL:`, url);
        clipUrls.push(url);
    }

    // Fetch Audio URL
    console.log(`\nQuerying Kie Audio Task: ${audioTaskId}...`);
    const audioRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${audioTaskId}`, {
        headers: { 'Authorization': `Bearer ${kieApiKey}` }
    });
    const audioJson = await audioRes.json();
    console.log(`Audio Task ${audioTaskId} State:`, audioJson.data?.state);
    const rawAudioUrl = extractUrlFromKie(audioJson);
    if (!rawAudioUrl) throw new Error(`Could not extract audio URL for task ${audioTaskId}! JSON: ${JSON.stringify(audioJson)}`);
    console.log(`Raw Audio URL:`, rawAudioUrl);

    // Persist audio to R2
    console.log("\n=== STEP 2: Persisting Audio to R2 ===");
    const audioFetchRes = await fetch(rawAudioUrl);
    const audioBuffer = Buffer.from(await audioFetchRes.arrayBuffer());
    const audioKey = `voiceover/${Date.now()}_grok_recovered.mp3`;
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: audioKey,
        Body: audioBuffer,
        ContentType: 'audio/mpeg'
    }));
    const r2AudioUrl = `${R2_PUBLIC_URL}/adrolls-storage/${audioKey}`;
    console.log("Audio persisted to R2:", r2AudioUrl);

    // Render Stitch on AWS Lambda
    console.log("\n=== STEP 3: Dispatching AWS Lambda Stitch Render ===");
    const functionName = speculateFunctionName({ diskSizeInMb: 512, memorySizeInMb: 2048, timeoutInSeconds: 900 });
    const bucketName = process.env.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
    const siteName = process.env.REMOTION_AWS_SITE_NAME || 'nobogent-site';
    const region = (process.env.REMOTION_AWS_REGION || 'us-east-1');

    const renderResult = await renderMediaOnLambda({
        region,
        functionName,
        serveUrl: `https://${bucketName}.s3.${region}.amazonaws.com/sites/${siteName}/index.html`,
        composition: 'StitchComposition',
        inputProps: {
            videoUrls: clipUrls,
            audioUrl: r2AudioUrl,
            clipDurationInSeconds: 15
        },
        codec: 'h264',
        imageFormat: 'jpeg',
        maxRetries: 2,
        privacy: 'public',
        framesPerLambda: 225,
        forceDurationInFrames: 900
    });

    console.log("Lambda Render Dispatched with ID:", renderResult.renderId);
    console.log("Polling Lambda progress...");

    let finalS3Url = null;
    for (let p = 0; p < 45; p++) {
        await new Promise(r => setTimeout(r, 4000));
        const prog = await getRenderProgress({ renderId: renderResult.renderId, bucketName, functionName, region });
        console.log(`[Progress ${p + 1}] Frames: ${prog.framesRendered}/900, Done: ${prog.done}`);
        if (prog.done && prog.outputFile) {
            finalS3Url = prog.outputFile;
            console.log("\nSUCCESS: AWS Lambda render complete!");
            console.log("S3 Output URL:", finalS3Url);
            break;
        }
    }

    if (!finalS3Url) throw new Error("AWS Lambda render timed out!");

    // Download from S3 and upload to R2 for permanent storage
    console.log("\n=== STEP 4: Transferring Final Video to R2 ===");
    const finalVideoRes = await fetch(finalS3Url);
    const finalBuffer = Buffer.from(await finalVideoRes.arrayBuffer());
    const finalR2Key = `generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/stitched_${Date.now()}.mp4`;

    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: finalR2Key,
        Body: finalBuffer,
        ContentType: 'video/mp4'
    }));

    const finalR2Url = `${R2_PUBLIC_URL}/adrolls-storage/${finalR2Key}`;
    console.log("Final Video R2 URL:", finalR2Url);

    // Update Supabase Asset status to Draft
    console.log("\n=== STEP 5: Updating Supabase Asset Record ===");
    const { data: updatedAsset, error: updateErr } = await supabaseAdmin
        .from('assets')
        .update({
            url: finalR2Url,
            status: 'Draft'
        })
        .eq('id', assetId)
        .select()
        .single();

    if (updateErr) {
        console.error("Error updating asset in Supabase:", updateErr);
    } else {
        console.log("SUCCESS! Supabase Asset updated successfully:");
        console.log("Asset ID:", updatedAsset.id);
        console.log("Status:", updatedAsset.status);
        console.log("URL:", updatedAsset.url);
    }
}

main().catch(console.error);
