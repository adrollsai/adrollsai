const { createClient } = require('@supabase/supabase-js');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const os = require('os');
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
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'adrolls-storage';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';

async function recoverAsset(assetId, userId, sceneUrl) {
    console.log(`\n=== Recovering Asset ${assetId} for User ${userId} ===`);
    try {
        // 1. Download scene_0
        console.log(`Downloading scene from ${sceneUrl}...`);
        const response = await fetch(sceneUrl);
        if (!response.ok) {
            throw new Error(`Failed to download scene from ${sceneUrl}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());

        // 2. Upload to R2 as stitched_...
        const finalFileName = `generated/${userId}/stitched_${Date.now()}.mp4`;
        console.log(`Uploading to R2 as ${finalFileName}...`);
        await r2Client.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: finalFileName,
            Body: buffer,
            ContentType: 'video/mp4'
        }));

        const persistedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${finalFileName}`;
        console.log(`Uploaded to R2: ${persistedUrl}`);

        // 3. Update database asset record
        console.log(`Updating asset ${assetId} status to Draft and setting URL...`);
        const { data: updatedAsset, error: updateErr } = await supabase
            .from('assets')
            .update({
                url: persistedUrl,
                status: 'Draft',
                metadata: {} // Clear any error metadata
            })
            .eq('id', assetId)
            .select()
            .single();

        if (updateErr) {
            console.error("Error updating asset in database:", updateErr);
            return;
        }
        console.log(`Asset updated in DB successfully.`);

        // 4. Delete the video_tasks records
        console.log("Cleaning up completed video tasks from DB...");
        const { error: deleteErr } = await supabase
            .from('video_tasks')
            .delete()
            .eq('asset_id', assetId);
            
        if (deleteErr) {
            console.error("Failed to clean up video_tasks:", deleteErr);
        } else {
            console.log("Video tasks cleaned up successfully.");
        }

        console.log(`=== Recovery Successful for Asset ${assetId}! ===`);

    } catch (e) {
        console.error(`Recovery failed for asset ${assetId}:`, e);
    }
}

async function main() {
    // Stuck Asset 1: df2d5820-3cd2-483e-8b53-9e86ad88108c
    await recoverAsset(
        'df2d5820-3cd2-483e-8b53-9e86ad88108c',
        'bc63c065-9bcc-4793-bedc-f0960406425b',
        'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/bc63c065-9bcc-4793-bedc-f0960406425b/scene_0_1780142464130.mp4'
    );

    // Stuck Asset 2: 79242304-9f7b-4ca2-a738-86858579e8c2
    await recoverAsset(
        '79242304-9f7b-4ca2-a738-86858579e8c2',
        'bc63c065-9bcc-4793-bedc-f0960406425b',
        'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/bc63c065-9bcc-4793-bedc-f0960406425b/scene_0_1780143371301.mp4'
    );
}

main().catch(console.error);
