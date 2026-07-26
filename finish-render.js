const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { getRenderProgress } = require('@remotion/lambda');
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

async function finishUp() {
    const functionName = speculateFunctionName({ diskSizeInMb: 512, memorySizeInMb: 2048, timeoutInSeconds: 900 });
    const bucketName = 'remotionlambda-useast1-k8ta4ch4gl';
    const region = 'us-east-1';
    const renderId = 'h9uom2ee4k';

    console.log("Checking render progress for renderId:", renderId);

    const prog = await getRenderProgress({ renderId, bucketName, functionName, region });
    console.log("Done:", prog.done);
    console.log("Frames rendered:", prog.framesRendered);
    console.log("Output file:", prog.outputFile);
    console.log("Errors:", prog.errors);
    console.log("Fatal error:", prog.fatalErrorEncountered);

    if (prog.done && prog.outputFile) {
        const finalVideoUrl = prog.outputFile;
        console.log("\n=======================================================");
        console.log("SUCCESS: FINAL STITCHED GROK VIDEO RENDERED:");
        console.log(finalVideoUrl);
        console.log("=======================================================");

        console.log("\n=== STEP 5: Updating Supabase Asset Records ===");
        const captionText = "Experience luxury smart living at The Ananta Aspire, Zirakpur NH-7. Fully automated 3BHK & 4BHK smart homes with rooftop pool & 3-tier security. DM or call to book your site visit today! 🚀";

        const assetId1 = crypto.randomUUID();
        const assetId2 = crypto.randomUUID();

        // Insert for bluesquareinfra
        const r1 = await fetch(`${supabaseUrl}/rest/v1/assets`, {
            method: 'POST',
            headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
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
        console.log("Asset insert bluesquareinfra:", r1.status, await r1.text());

        // Insert for active UI profile (The ProEstate)
        const r2 = await fetch(`${supabaseUrl}/rest/v1/assets`, {
            method: 'POST',
            headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
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
        console.log("Asset insert ProEstate:", r2.status, await r2.text());

        console.log("\n✅ ALL DONE! Final video with 2 Grok clips + Gemini TTS voiceover is now in your Assets dashboard!");
    } else {
        console.log("Render not yet done or no output file. Full progress:", JSON.stringify(prog, null, 2));
    }
}

finishUp();
