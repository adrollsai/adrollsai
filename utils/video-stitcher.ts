import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { getFfmpegPath } from '@/utils/ffmpeg-helper';
import { generateAndUploadVideoThumbnail } from '@/utils/video-thumbnail-helper';
import { sendPushNotification } from '@/utils/notification-helper';

const CLOUD_RUN_WORKER_URL = process.env.CLOUD_RUN_WORKER_URL || 'https://adrolls-stitcher-worker-805895515412.us-central1.run.app';

export interface StitchTaskContext {
    asset_id: string;
    user_id: string;
    prompts?: string[];
}

export interface StitchSibling {
    current_index: number;
    last_successful_task_id: string;
}

/**
 * Attempts to offload stitching to the dedicated Cloud Run worker container.
 * The Cloud Run worker has system-level FFmpeg pre-installed and runs asynchronously.
 */
export async function dispatchCloudRunStitch(
    siblings: StitchSibling[],
    videoTask: StitchTaskContext,
    audioUrl?: string | null
): Promise<boolean> {
    try {
        console.log(`[Video Stitcher] Dispatching stitch for Asset ${videoTask.asset_id} to Cloud Run: ${CLOUD_RUN_WORKER_URL}/stitch`);
        const res = await fetch(`${CLOUD_RUN_WORKER_URL}/stitch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                siblings,
                videoTask: {
                    asset_id: videoTask.asset_id,
                    user_id: videoTask.user_id,
                    prompts: videoTask.prompts
                },
                audioUrl: audioUrl || undefined
            }),
            signal: AbortSignal.timeout(8000)
        });

        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            console.log(`[Video Stitcher] Cloud Run accepted stitch request successfully:`, data);
            return true;
        } else {
            const text = await res.text().catch(() => '');
            console.warn(`[Video Stitcher] Cloud Run stitch responded with HTTP ${res.status}: ${text}`);
            return false;
        }
    } catch (err: any) {
        console.warn(`[Video Stitcher] Cloud Run worker stitch dispatch error:`, err?.message || err);
        return false;
    }
}

/**
 * Performs fast direct FFmpeg stitching locally or inside the serverless execution environment.
 * Replaces clip audio with the voiceover stream (-map 0:v:0 -map 1:a:0) and uploads to R2.
 */
export async function stitchClipsLocally(
    siblings: StitchSibling[],
    videoTask: StitchTaskContext,
    audioUrl: string | null,
    supabaseAdmin: any
): Promise<{ finalR2Url: string; thumbnailUrl: string | null }> {
    const tempStitchDir = path.join(os.tmpdir(), `stitch_${videoTask.asset_id}_${Date.now()}`);
    if (!fs.existsSync(tempStitchDir)) {
        fs.mkdirSync(tempStitchDir, { recursive: true });
    }

    try {
        // 1. Download all scene clips
        const localClipPaths: string[] = [];
        for (let idx = 0; idx < siblings.length; idx++) {
            const s = siblings[idx];
            const clipPath = path.join(tempStitchDir, `scene_${idx}.mp4`);
            console.log(`[Local Stitch] Downloading scene ${idx + 1}/${siblings.length}: ${s.last_successful_task_id}`);
            const clipRes = await fetch(s.last_successful_task_id);
            if (!clipRes.ok) throw new Error(`Failed to download scene ${idx + 1} (${s.last_successful_task_id})`);
            fs.writeFileSync(clipPath, Buffer.from(await clipRes.arrayBuffer()));
            localClipPaths.push(clipPath);
        }

        // 2. Concat list
        const concatTxtContent = localClipPaths.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
        const concatTxtPath = path.join(tempStitchDir, 'concat.txt');
        fs.writeFileSync(concatTxtPath, concatTxtContent);

        // 3. Download voiceover audio if present
        let localAudioPath: string | null = null;
        if (audioUrl && (audioUrl.startsWith('http://') || audioUrl.startsWith('https://'))) {
            try {
                const cleanAudioUrl = audioUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/');
                console.log(`[Local Stitch] Downloading voiceover audio: ${cleanAudioUrl}`);
                const audioRes = await fetch(cleanAudioUrl);
                if (audioRes.ok) {
                    localAudioPath = path.join(tempStitchDir, 'voiceover.mp3');
                    fs.writeFileSync(localAudioPath, Buffer.from(await audioRes.arrayBuffer()));
                }
            } catch (audErr) {
                console.warn(`[Local Stitch] Failed to download voiceover audio:`, audErr);
            }
        }

        const ffmpegExec = getFfmpegPath();
        const outputPath = path.join(tempStitchDir, 'final_stitched.mp4');

        // Mux voiceover audio replacing native video noise (-map 0:v:0 -map 1:a:0)
        const ffmpegCmd = localAudioPath
            ? `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -i "${localAudioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "${outputPath}"`
            : `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -c copy -movflags +faststart "${outputPath}"`;

        console.log(`[Local Stitch] Executing FFmpeg command: ${ffmpegCmd}`);
        await new Promise<void>((resolve, reject) => {
            exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr, stdout, stderr) => {
                if (execErr) {
                    console.error(`[Local Stitch] FFmpeg error:`, stderr || execErr);
                    reject(execErr);
                } else {
                    resolve();
                }
            });
        });

        // 4. Upload stitched file to R2
        const stitchedBuffer = fs.readFileSync(outputPath);
        const r2Key = `generated/${videoTask.user_id}/stitched_${Date.now()}.mp4`;
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: stitchedBuffer,
            ContentType: 'video/mp4'
        }));

        const finalR2Url = `${R2_PUBLIC_URL}/${r2Key}`;
        console.log(`[Local Stitch] Successfully uploaded stitched MP4 to R2: ${finalR2Url}`);

        // 5. Generate thumbnail
        let thumbnailUrl: string | null = null;
        try {
            thumbnailUrl = await generateAndUploadVideoThumbnail(outputPath, videoTask.user_id, videoTask.asset_id);
        } catch (thumbErr) {
            console.error("[Local Stitch] Thumbnail generation error:", thumbErr);
        }

        // 6. Update Supabase asset
        if (videoTask.asset_id) {
            await supabaseAdmin.from('assets').update({
                url: finalR2Url,
                status: 'Draft',
                created_at: new Date().toISOString(),
                metadata: {
                    ...(thumbnailUrl ? { thumbnailUrl } : {}),
                    ...(audioUrl ? { audioUrl } : {})
                }
            }).eq('id', videoTask.asset_id);
        }

        // 7. Clean up video tasks
        await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);

        // 8. Send push notification
        await sendPushNotification(
            videoTask.user_id,
            `🎬 Grok Video Creative Ready!`,
            `Your multi-scene AI video ad with voiceover has been generated & stitched successfully.`,
            "/dashboard/assets",
            "asset_ready"
        ).catch(() => {});

        return { finalR2Url, thumbnailUrl };

    } finally {
        try { fs.rmSync(tempStitchDir, { recursive: true, force: true }); } catch (_) {}
    }
}
