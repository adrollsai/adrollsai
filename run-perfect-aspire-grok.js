const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const crypto = require('crypto');
const { renderMediaOnLambda } = require('@remotion/lambda');
const { speculateFunctionName } = require('@remotion/lambda-client');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));
process.env.AWS_ACCESS_KEY_ID = envConfig.REMOTION_AWS_ACCESS_KEY_ID || envConfig.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = envConfig.REMOTION_AWS_SECRET_ACCESS_KEY || envConfig.AWS_SECRET_ACCESS_KEY;
process.env.REMOTION_AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
process.env.REMOTION_AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;
const kieApiKey = envConfig.KIE_API_KEY;

const userId = "2f62a259-f23b-48ee-a920-c436f36eaa4b"; // bluesquareinfra
const userIdProEstate = "29937131-1975-4c5f-9b78-e5b28f918d32"; // active UI profile
const propertyId = "31f442a8-971d-4ead-9e05-a8eccc1a0f43"; // The Ananta Aspire

const refImages = [
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1779799853507-yshfya.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1779799853475-me71bg.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1779799853444-37gqe.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1779799853541-oaefhg.jpg"
];

async function runPerfectPipeline() {
    console.log("=== STEP 1: Creating 9:16 Grid Collage using Sharp ===");
    const fetchedBuffers = await Promise.all(refImages.map(async (url) => {
        const res = await fetch(url);
        return Buffer.from(await res.arrayBuffer());
    }));

    const canvasWidth = 1080;
    const canvasHeight = 1920;
    const cellWidth = 540;
    const cellHeight = 960;

    const overlays = [];
    for (let i = 0; i < fetchedBuffers.length; i++) {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const resized = await sharp(fetchedBuffers[i])
            .resize(cellWidth, cellHeight, { fit: 'cover', position: 'center' })
            .toBuffer();
        overlays.push({ input: resized, top: row * cellHeight, left: col * cellWidth });
    }

    const collageBuffer = await sharp({
        create: { width: canvasWidth, height: canvasHeight, channels: 3, background: { r: 15, g: 23, b: 42 } }
    })
    .composite(overlays)
    .jpeg({ quality: 92 })
    .toBuffer();

    // Upload 9:16 collage to R2 directly
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const r2 = new S3Client({
        region: 'auto',
        endpoint: `https://${envConfig.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: envConfig.R2_ACCESS_KEY_ID,
            secretAccessKey: envConfig.R2_SECRET_ACCESS_KEY
        }
    });
    const R2_BUCKET = envConfig.R2_BUCKET_NAME || 'adrolls-storage';
    const R2_PUBLIC_URL = envConfig.NEXT_PUBLIC_R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';
    const collageKey = `generated/${userId}/ananta_aspire_collage_916_${Date.now()}.jpg`;

    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: collageKey,
        Body: collageBuffer,
        ContentType: 'image/jpeg'
    }));

    const collageUrl = `${R2_PUBLIC_URL}/adrolls-storage/${collageKey}`;
    console.log("SUCCESS: 9:16 Collage URL generated & uploaded to R2:", collageUrl);

    console.log("\n=== STEP 2: Generating Gemini 3.1 Flash Voiceover Audio (Voice: Aoede) ===");
    const dialogueText = "Tricity mein luxury home dhoondh rahe ho? Zirakpur NH-7 par The Ananta Aspire lekar aaya hai fully automated smart homes with dual core tower design, jahan ek floor par sirf do apartments hain. Yahan aapko milenge rooftop swimming pool, 3-tier security, aur IT City Mohali se seamless connectivity. Aaj hi book karein apna private tour!";

    const ttsPayload = {
        model: "google/gemini-3-1-flash-tts",
        input: {
            speakers: [{ speaker_id: "Speaker 1", voice_name: "Aoede", audio_profile: "", style: "Deadpan", pace: "Natural", accent: "Neutral" }],
            dialogue_turns: [{ speaker_id: "Speaker 1", text: dialogueText }],
            temperature: 1,
            scene: "Professional commercial studio recording",
            sample_context: "High converting promo voiceover"
        }
    };

    const ttsRes = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${kieApiKey}` },
        body: JSON.stringify(ttsPayload)
    });
    const ttsData = await ttsRes.json();
    const ttsTaskId = ttsData.data.taskId;
    console.log(`TTS Task ID: ${ttsTaskId}. Polling completion...`);

    let rawTtsUrl = null;
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const info = await (await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${ttsTaskId}`, { headers: { 'Authorization': `Bearer ${kieApiKey}` } })).json();
        if (info.data?.state === 'success' && info.data?.resultJson) {
            const parsed = JSON.parse(info.data.resultJson);
            rawTtsUrl = parsed.resultUrls?.[0] || parsed.url;
            console.log("SUCCESS: Raw TTS Audio URL:", rawTtsUrl);
            break;
        }
    }

    if (!rawTtsUrl) throw new Error("TTS generation failed!");

    // Upload audio MP3 to R2
    const audioRes = await fetch(rawTtsUrl);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
    const audioKey = `voiceover/${Date.now()}_voiceover.mp3`;
    await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: audioKey, Body: audioBuffer, ContentType: 'audio/mpeg' }));
    const r2AudioUrl = `${R2_PUBLIC_URL}/adrolls-storage/${audioKey}`;
    console.log("SUCCESS: Voiceover audio persisted to R2:", r2AudioUrl);

    console.log("\n=== STEP 3: Launching 2x 15s Grok Imagine Tasks (Silent Directives) ===");
    const prompts = [
        "Reference 9:16 collage image as identity lock. Create an ultrarealistic live-action 9:16 commercial featuring an animated A-roll of the products with a slow dramatic push-in zoom, soft studio lighting, and elegant depth of field. Silent video clip without any voiceover, speech, talking, background narration, ambient audio, or text overlays.",
        "Reference 9:16 collage image as identity lock. Create an ultrarealistic live-action 9:16 commercial featuring an animated A-roll with an orbital 360 camera move showcasing product textures and sleek reflections. Silent video clip without any voiceover, speech, talking, background narration, ambient audio, or text overlays."
    ];

    const clipUrls = [];
    for (let idx = 0; idx < 2; idx++) {
        const grokPayload = {
            model: "grok-imagine-video-1-5-preview",
            input: { prompt: prompts[idx], aspect_ratio: "9:16", resolution: "480p", duration: 15, nsfw_checker: true, image_urls: [collageUrl] }
        };

        const gRes = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${kieApiKey}` },
            body: JSON.stringify(grokPayload)
        });
        const gData = await gRes.json();
        const taskId = gData.data.taskId;
        console.log(`Grok Task ${idx + 1} ID: ${taskId}. Polling completion...`);

        for (let attempt = 0; attempt < 40; attempt++) {
            await new Promise(r => setTimeout(r, 4000));
            const info = await (await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers: { 'Authorization': `Bearer ${kieApiKey}` } })).json();
            if (info.data?.state === 'success' && info.data?.resultJson) {
                const parsed = JSON.parse(info.data.resultJson);
                const clipUrl = parsed.resultUrls?.[0] || parsed.url;
                console.log(`SUCCESS: Grok Clip ${idx + 1} URL:`, clipUrl);
                clipUrls.push(clipUrl);
                break;
            }
        }
    }

    if (clipUrls.length < 2) throw new Error("Grok clip generation incomplete!");

    console.log("\n=== STEP 4: Rendering Stitched 30s Video on AWS Lambda (Muted Clip Audio + R2 Voiceover) ===");
    const assetId1 = crypto.randomUUID();
    const assetId2 = crypto.randomUUID();

    const functionName = speculateFunctionName({ diskSizeInMb: 512, memorySizeInMb: 2048, timeoutInSeconds: 900 });
    const bucketName = process.env.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
    const siteName = process.env.REMOTION_AWS_SITE_NAME || 'nobogent-site';
    const region = (process.env.REMOTION_AWS_REGION || 'us-east-1');

    const renderResult = await renderMediaOnLambda({
        region,
        functionName,
        serveUrl: `https://${bucketName}.s3.${region}.amazonaws.com/sites/${siteName}/index.html`,
        composition: 'StitchComposition',
        inputProps: { videoUrls: clipUrls, audioUrl: r2AudioUrl, clipDurationInSeconds: 15 },
        codec: 'h264',
        imageFormat: 'jpeg',
        maxRetries: 2,
        privacy: 'public',
        framesPerLambda: 225,
        forceDurationInFrames: 900
    });

    console.log("Lambda Render Dispatched with ID:", renderResult.renderId);
    console.log("Polling Lambda progress...");

    const { getRenderProgress } = require('@remotion/lambda');
    let finalVideoUrl = null;

    for (let p = 0; p < 45; p++) {
        await new Promise(r => setTimeout(r, 4000));
        const prog = await getRenderProgress({ renderId: renderResult.renderId, bucketName, functionName, region });
        console.log(`[Progress ${p + 1}] Frames: ${prog.framesRendered}/900, Done: ${prog.done}`);
        if (prog.done && prog.outputFile) {
            finalVideoUrl = prog.outputFile;
            console.log("\n=======================================================");
            console.log("SUCCESS: FINAL STITCHED 30s GROK VIDEO RENDERED:");
            console.log(finalVideoUrl);
            console.log("=======================================================");
            break;
        }
    }

    if (!finalVideoUrl) throw new Error("AWS Lambda render timed out!");

    console.log("\n=== STEP 5: Updating Supabase Asset Records ===");
    const captionText = "Experience luxury smart living at The Ananta Aspire, Zirakpur NH-7. Fully automated 3BHK & 4BHK smart homes with rooftop pool & 3-tier security. DM or call to book your site visit today! 🚀";

    // Insert for bluesquareinfra
    await fetch(`${supabaseUrl}/rest/v1/assets`, {
        method: 'POST',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: assetId1,
            user_id: userId,
            property_id: propertyId,
            type: "video",
            status: "Draft",
            url: finalVideoUrl,
            caption: captionText,
            created_at: new Date().toISOString()
        })
    });

    // Insert for active UI profile (The ProEstate)
    await fetch(`${supabaseUrl}/rest/v1/assets`, {
        method: 'POST',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: assetId2,
            user_id: userIdProEstate,
            property_id: propertyId,
            type: "video",
            status: "Draft",
            url: finalVideoUrl,
            caption: captionText,
            created_at: new Date().toISOString()
        })
    });

    console.log("\nDONE! Stitched 30s video with 9:16 grid collage, muted clip audio, and full Gemini TTS voiceover is now live in both account dashboards!");
}

runPerfectPipeline();
