import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { sendPushNotification } from '@/utils/notification-helper';
import { generateAndUploadVideoThumbnail } from '@/utils/video-thumbnail-helper';
import fs from 'fs';
import path from 'path';
import os from 'os';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    console.log(`[Lambda Callback] Incoming request: ${request.method} ${request.url}`);

    try {
        const payload = await request.json();
        console.log(`[Lambda Callback] Payload:`, JSON.stringify(payload, null, 2));

        const { type, outputUrl, customData, errors } = payload;
        const renderError = errors && Array.isArray(errors) && errors.length > 0
            ? errors.map((e: any) => e.message).join('\n')
            : (payload.error || "AWS Lambda rendering failed.");
        const assetId = customData?.assetId;
        const isStitch = customData?.isStitch;
        const isSuccess = type === 'success';

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
        if (!isSuccess) {
            console.error(`[Lambda Callback] Render/Stitch failed for asset ${assetId}:`, renderError);
            
            await supabaseAdmin
                .from('assets')
                .update({ 
                    status: 'Failed',
                    metadata: { ...asset.metadata, error: renderError || "AWS Lambda rendering failed." }
                })
                .eq('id', assetId);

            if (isStitch) {
                // Find sibling tasks sharing this asset_id to know the number of clips generated
                const { data: siblingTasks } = await supabaseAdmin
                    .from('video_tasks')
                    .select('id')
                    .eq('asset_id', assetId);
                const taskCount = siblingTasks?.length || 1;

                // Delete all video tasks sharing this asset_id
                await supabaseAdmin.from('video_tasks').delete().eq('asset_id', assetId);

                // Refund limit
                try {
                    const { refundLimit } = await import('@/utils/subscription-server');
                    await refundLimit(asset.user_id, 'videos');
                } catch (limErr) {
                    console.error("Failed to refund videos limit on stitch fail:", limErr);
                }

                // Refund credits
                try {
                    const { addCredits } = await import('@/utils/credits');
                    await addCredits(supabaseAdmin, asset.user_id, taskCount * 250, 'ai_generation', `Refund: Video stitching failed (${taskCount} clips)`);
                } catch (refundErr) {
                    console.error("Failed to refund credits on stitch fail:", refundErr);
                }
            } else {
                // Refund edit render credits
                try {
                    const { addCredits } = await import('@/utils/credits');
                    await addCredits(supabaseAdmin, asset.user_id, 20, 'ai_generation', `Refund: Video render failed`);
                } catch (refundErr) {
                    console.error("Failed to refund credits on video render fail:", refundErr);
                }
            }

            return NextResponse.json({ success: true, message: "Asset marked as failed and credits/limit refunded" });
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

        const r2Key = isStitch 
            ? `generated/${asset.user_id}/stitched_${Date.now()}.mp4`
            : `renders/${asset.user_id}/${assetId}.mp4`;
        console.log(`[Lambda Callback] Uploading finished video to Cloudflare R2 bucket ${R2_BUCKET} at key: ${r2Key}`);

        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: buffer,
            ContentType: 'video/mp4'
        }));

        const r2Url = `${R2_PUBLIC_URL}/adrolls-storage/${r2Key}`;
        console.log(`[Lambda Callback] Upload complete. R2 URL: ${r2Url}`);

        // Generate video thumbnail
        let thumbnailUrl = null;
        const tempDir = os.tmpdir();
        const tempVideoPath = path.join(tempDir, `stitch-${assetId}-${Date.now()}.mp4`);
        try {
            fs.writeFileSync(tempVideoPath, buffer);
            thumbnailUrl = await generateAndUploadVideoThumbnail(tempVideoPath, asset.user_id, assetId);
        } catch (thumbErr) {
            console.error("[Lambda Callback] Failed to generate thumbnail:", thumbErr);
        } finally {
            if (fs.existsSync(tempVideoPath)) {
                try { fs.unlinkSync(tempVideoPath); } catch (e) {}
            }
        }

        // 4. Update asset status and url
        const updatedMetadata = {
            ...(asset.metadata || {}),
            timeToRenderInMs: payload.timeToRenderInMs,
            lambdasUsed: payload.lambdasUsed,
            renderId: payload.renderId,
            renderTimeSeconds: payload.timeToRenderInMs ? (payload.timeToRenderInMs / 1000) : undefined,
            ...(thumbnailUrl ? { thumbnailUrl } : {})
        };

        const { error: updateErr } = await supabaseAdmin
            .from('assets')
            .update({
                url: r2Url,
                status: 'Draft', // Turns spinning card into completed card
                metadata: updatedMetadata
            })
            .eq('id', assetId);

        if (updateErr) {
            console.error(`[Lambda Callback] Failed to update asset row in Supabase:`, updateErr);
            throw updateErr;
        }

        if (isStitch) {
            // Clean up database video_tasks records
            await supabaseAdmin.from('video_tasks').delete().eq('asset_id', assetId);
        }

        // 5. Send push notification to user
        try {
            const title = isStitch ? `🎬 Video Creative Ready!` : `🎬 Edited Video Ready!`;
            const body = isStitch ? `Your stitched AI video ad has been generated successfully.` : `Your AI-edited video ad has been generated successfully.`;
            await sendPushNotification(
                asset.user_id, 
                title, 
                body, 
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
