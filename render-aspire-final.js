const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { renderMediaOnLambda, getRenderProgress } = require('@remotion/lambda');
const { speculateFunctionName } = require('@remotion/lambda-client');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));
process.env.AWS_ACCESS_KEY_ID = envConfig.REMOTION_AWS_ACCESS_KEY_ID || envConfig.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = envConfig.REMOTION_AWS_SECRET_ACCESS_KEY || envConfig.AWS_SECRET_ACCESS_KEY;
process.env.REMOTION_AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
process.env.REMOTION_AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;

const userId = "2f62a259-f23b-48ee-a920-c436f36eaa4b"; // bluesquareinfra
const userIdProEstate = "29937131-1975-4c5f-9b78-e5b28f918d32"; // active UI profile
const propertyId = "31f442a8-971d-4ead-9e05-a8eccc1a0f43"; // The Ananta Aspire

const clipUrls = [
    "https://tempfile.aiquickdraw.com/ggg/users/759ffd06-b473-4110-be72-149cbd9b9aa7/generated/a12c18a1-9ecf-42cf-b614-4ea731c71cbb/generated_video.mp4",
    "https://tempfile.aiquickdraw.com/ggg/users/02da2fbe-69af-4049-9369-b6de0860465c/generated/1ecf42f9-dc83-4552-b131-920411dccca2/generated_video.mp4"
];
const audioUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/voiceover/1785050005565_voiceover.mp3";

async function renderFinal() {
    console.log("=== STEP 4: Rendering Stitched Video on AWS Lambda ===");
    console.log("Clip 1:", clipUrls[0]);
    console.log("Clip 2:", clipUrls[1]);
    console.log("Voiceover Audio MP3:", audioUrl);

    const functionName = speculateFunctionName({ diskSizeInMb: 512, memorySizeInMb: 2048, timeoutInSeconds: 900 });
    const bucketName = process.env.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
    const siteName = process.env.REMOTION_AWS_SITE_NAME || 'nobogent-site';
    const region = (process.env.REMOTION_AWS_REGION || 'us-east-1');

    const renderResult = await renderMediaOnLambda({
        region,
        functionName,
        serveUrl: `https://${bucketName}.s3.${region}.amazonaws.com/sites/${siteName}/index.html`,
        composition: 'StitchComposition',
        inputProps: { videoUrls: clipUrls, audioUrl, clipDurationInSeconds: 8 },
        codec: 'h264',
        imageFormat: 'jpeg',
        maxRetries: 2,
        privacy: 'public',
        framesPerLambda: 225
    });

    console.log("Lambda Render Dispatched with ID:", renderResult.renderId);
    console.log("Polling Lambda progress...");

    let finalVideoUrl = null;

    for (let p = 0; p < 45; p++) {
        await new Promise(r => setTimeout(r, 4000));
        const prog = await getRenderProgress({ renderId: renderResult.renderId, bucketName, functionName, region });
        console.log(`[Progress ${p + 1}] Frames: ${prog.framesRendered}, Done: ${prog.done}`);
        if (prog.done && prog.outputFile) {
            finalVideoUrl = prog.outputFile;
            console.log("\n=======================================================");
            console.log("SUCCESS: FINAL STITCHED GROK VIDEO RENDERED:");
            console.log(finalVideoUrl);
            console.log("=======================================================");
            break;
        }
    }

    if (!finalVideoUrl) throw new Error("AWS Lambda render timed out!");

    console.log("\n=== STEP 5: Updating Supabase Asset Records ===");
    const captionText = "Experience luxury smart living at The Ananta Aspire, Zirakpur NH-7. Fully automated 3BHK & 4BHK smart homes with rooftop pool & 3-tier security. DM or call to book your site visit today! 🚀";

    const assetId1 = crypto.randomUUID();
    const assetId2 = crypto.randomUUID();

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

    console.log("\nALL DONE! Complete video with 9:16 grid collage, 2 Grok clips, muted native clip audio, and full Gemini TTS voiceover is now live in your Assets dashboard!");
}

renderFinal();
