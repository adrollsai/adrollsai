import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { sendPushNotification } from '@/utils/notification-helper';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    console.log(`[Lambda Callback] Incoming request: ${request.method} ${request.url}`);

    try {
        const payload = await request.json();
        console.log(`[Lambda Callback] Payload:`, JSON.stringify(payload, null, 2));

        const { success, outputUrl, customData, error: renderError } = payload;
        const assetId = customData?.assetId;

        if (!assetId) {
            console.error("[Lambda Callback] Missing assetId in customData.");
            return NextResponse.json({ error: "Missing assetId in callback customData" }, { status: 400 });
        }

        // 1. Fetch asset details
        const { data: asset, error: fetchErr } = await supabaseAdmin
            .from('assets')
            .select('*')
            .eq('id', assetId)
            .single();

        if (fetchErr || !asset) {
            console.error(`[Lambda Callback] Asset ${assetId} not found in database:`, fetchErr);
            return NextResponse.json({ error: "Asset not found" }, { status: 404 });
        }

        // 2. Handle failure
        if (!success) {
            console.error(`[Lambda Callback] Render failed for asset ${assetId}:`, renderError);
            
            await supabaseAdmin
                .from('assets')
                .update({ 
                    status: 'Failed',
                    metadata: { ...asset.metadata, error: renderError || "AWS Lambda rendering failed." }
                })
                .eq('id', assetId);

            return NextResponse.json({ success: true, message: "Asset marked as failed" });
        }

        // 3. Handle success - download file from S3 and upload to Cloudflare R2
        if (!outputUrl) {
            console.error("[Lambda Callback] Missing outputUrl in success callback payload.");
            return NextResponse.json({ error: "Missing outputUrl" }, { status: 400 });
        }

        console.log(`[Lambda Callback] Downloading rendered video from AWS S3: ${outputUrl}`);
        const videoRes = await fetch(outputUrl);
        if (!videoRes.ok) {
            throw new Error(`Failed to download output video from AWS S3: ${videoRes.statusText}`);
        }

        const arrayBuffer = await videoRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const r2Key = `renders/${asset.user_id}/${assetId}.mp4`;
        console.log(`[Lambda Callback] Uploading finished video to Cloudflare R2 bucket ${R2_BUCKET} at key: ${r2Key}`);

        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: buffer,
            ContentType: 'video/mp4'
        }));

        const r2Url = `${R2_PUBLIC_URL}/adrolls-storage/${r2Key}`;
        console.log(`[Lambda Callback] Upload complete. R2 URL: ${r2Url}`);

        // 4. Update asset status and url
        const { error: updateErr } = await supabaseAdmin
            .from('assets')
            .update({
                url: r2Url,
                status: 'Draft' // Turns spinning card into completed card
            })
            .eq('id', assetId);

        if (updateErr) {
            console.error(`[Lambda Callback] Failed to update asset row in Supabase:`, updateErr);
            throw updateErr;
        }

        // 5. Send push notification to user
        try {
            await sendPushNotification(
                asset.user_id, 
                `🎬 Edited Video Ready!`, 
                `Your AI-edited video ad has been generated successfully.`, 
                "/dashboard/assets", 
                "asset_ready"
            );
            console.log(`[Lambda Callback] Push notification dispatched to user: ${asset.user_id}`);
        } catch (pushErr) {
            console.error("[Lambda Callback] Push notification failed to send:", pushErr);
        }

        return NextResponse.json({ success: true, message: "Asset successfully updated to R2 and database finalized." });

    } catch (error: any) {
        console.error("[Lambda Callback] Fatal Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
