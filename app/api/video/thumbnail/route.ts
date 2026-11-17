import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const execPromise = promisify(exec);

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const videoUrl = searchParams.get('url');
        const assetId = searchParams.get('assetId');

        if (!videoUrl || videoUrl.includes('/processing')) {
            return new NextResponse('Missing or pending video URL', { status: 400 });
        }

        // 1. Check if asset already has a generated thumbnailUrl in Supabase DB metadata
        if (assetId) {
            const { data: asset } = await supabaseAdmin
                .from('assets')
                .select('metadata, user_id')
                .eq('id', assetId)
                .single();

            if (asset?.metadata?.thumbnailUrl) {
                const redirectUrl = asset.metadata.thumbnailUrl.startsWith('http')
                    ? asset.metadata.thumbnailUrl
                    : `${R2_PUBLIC_URL}/${asset.metadata.thumbnailUrl.replace(/^\//, '')}`;

                // Return proxy fetch of the existing thumbnail image
                const thumbRes = await fetch(redirectUrl);
                if (thumbRes.ok) {
                    const buffer = await thumbRes.arrayBuffer();
                    return new NextResponse(buffer, {
                        status: 200,
                        headers: {
                            'Content-Type': 'image/jpeg',
                            'Cache-Control': 'public, max-age=31536000, immutable'
                        }
                    });
                }
            }

            // Backoff: if poster extraction already failed for this asset (usually because the
            // file is too large to pull through a function), do not retry it on every page load.
            const failedAt = asset?.metadata?.thumbnailFailedAt
                ? Date.parse(asset.metadata.thumbnailFailedAt)
                : 0;
            if (!asset?.metadata?.thumbnailUrl && failedAt && Date.now() - failedAt < 6 * 60 * 60 * 1000) {
                return new NextResponse('Poster unavailable for this video', {
                    status: 404,
                    headers: { 'Cache-Control': 'public, max-age=600' }
                });
            }
        }

        // 2. Format source video URL (handling R2 path variations)
        let targetVideoUrl = videoUrl;
        if (targetVideoUrl.includes('r2.dev/adrolls-storage/')) {
            targetVideoUrl = targetVideoUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/');
        }

        console.log(`[VideoThumbnail API] Extracting frame from video URL: ${targetVideoUrl}`);

        const tempDir = os.tmpdir();
        const tempThumbPath = path.join(tempDir, `thumb_i_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);

        const nodeModulesFfmpeg = path.join(
            process.cwd(),
            'node_modules',
            'ffmpeg-static',
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        const ffmpeg = fs.existsSync(nodeModulesFfmpeg) ? nodeModulesFfmpeg : (ffmpegPath || 'ffmpeg');

        // Fast path: Stream frame directly over HTTP range requests using FFmpeg
        const streamCommand = `"${ffmpeg}" -y -ss 00:00:00.500 -i "${targetVideoUrl}" -vf "scale=360:-1" -vframes 1 "${tempThumbPath}"`;

        let success = false;
        try {
            await execPromise(streamCommand, { timeout: 12000 });
            if (fs.existsSync(tempThumbPath) && fs.statSync(tempThumbPath).size > 0) {
                success = true;
            }
        } catch (streamErr) {
            console.warn('[VideoThumbnail API] Stream command failed, trying fallback download:', streamErr);
        }

        // Fallback path: Download buffer to disk if remote stream failed
        if (!success) {
            // Never pull a huge file through a serverless function just to make a poster.
            const MAX_POSTER_SOURCE_BYTES = 30 * 1024 * 1024;
            let sourceBytes = 0;
            try {
                const headRes = await fetch(targetVideoUrl, { method: 'HEAD' });
                sourceBytes = Number(headRes.headers.get('content-length') || 0);
            } catch (sizeErr) {
                console.warn('[VideoThumbnail API] Could not read source size:', sizeErr);
            }
            if (sourceBytes > MAX_POSTER_SOURCE_BYTES) {
                throw new Error(`Video is ${(sourceBytes / 1048576).toFixed(1)} MB — too large for on-demand poster extraction`);
            }

            let videoRes = await fetch(targetVideoUrl);
            if (!videoRes.ok && targetVideoUrl !== videoUrl) {
                videoRes = await fetch(videoUrl);
            }

            if (!videoRes.ok) {
                throw new Error(`Failed to fetch video stream: HTTP ${videoRes.status}`);
            }

            const arrayBuffer = await videoRes.arrayBuffer();
            const tempVideoPath = path.join(tempDir, `thumb_v_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);
            fs.writeFileSync(tempVideoPath, Buffer.from(arrayBuffer));

            const fallbackCommand = `"${ffmpeg}" -y -ss 00:00:00.500 -i "${tempVideoPath}" -vf "scale=360:-1" -vframes 1 "${tempThumbPath}"`;
            await execPromise(fallbackCommand, { timeout: 20000 });
            try { fs.unlinkSync(tempVideoPath); } catch (e) {}
        }

        if (!fs.existsSync(tempThumbPath)) {
            throw new Error("FFmpeg failed to produce thumbnail frame");
        }

        const thumbBuffer = fs.readFileSync(tempThumbPath);

        // Cleanup temporary thumbnail file
        try { fs.unlinkSync(tempThumbPath); } catch (e) {}

        // 4. Upload generated JPEG thumbnail to Cloudflare R2
        const r2Key = `thumbnails/dynamic_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: thumbBuffer,
            ContentType: 'image/jpeg'
        }));

        const finalThumbUrl = `${R2_PUBLIC_URL}/${r2Key}`;

        // 5. Persist thumbnail URL to asset metadata in database for CDN caching
        if (assetId) {
            const { data: asset } = await supabaseAdmin.from('assets').select('metadata').eq('id', assetId).single();
            const updatedMeta = { ...(asset?.metadata || {}), thumbnailUrl: finalThumbUrl };
            await supabaseAdmin.from('assets').update({ metadata: updatedMeta }).eq('id', assetId);
        }

        return new NextResponse(thumbBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000, immutable'
            }
        });

    } catch (error: any) {
        console.error('[VideoThumbnail API] Error generating thumbnail:', error);

        // Remember the failure so the next page load does not repeat an expensive extraction.
        try {
            const failedAssetId = new URL(request.url).searchParams.get('assetId');
            if (failedAssetId) {
                const { data: failedAsset } = await supabaseAdmin
                    .from('assets')
                    .select('metadata')
                    .eq('id', failedAssetId)
                    .single();
                await supabaseAdmin
                    .from('assets')
                    .update({ metadata: { ...(failedAsset?.metadata || {}), thumbnailFailedAt: new Date().toISOString() } })
                    .eq('id', failedAssetId);
            }
        } catch (memoErr) {
            console.warn('[VideoThumbnail API] Could not record poster failure:', memoErr);
        }

        return new NextResponse('Error generating thumbnail', { status: 500 });
    }
}
