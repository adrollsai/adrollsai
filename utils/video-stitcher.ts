import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { getFfmpegPath, getFfprobePath } from '@/utils/ffmpeg-helper';
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
    last_task_id?: string | null;
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
 * Resiliently downloads a scene clip with automatic retry and Kie.ai emergency fallback.
 */
async function downloadSceneClipResiliently(s: StitchSibling, tempPath: string): Promise<void> {
    const urlsToTry: string[] = [];
    if (s.last_successful_task_id) {
        urlsToTry.push(s.last_successful_task_id);
        if (s.last_successful_task_id.includes('r2.dev/adrolls-storage/')) {
            urlsToTry.unshift(s.last_successful_task_id.replace('r2.dev/adrolls-storage/', 'r2.dev/'));
        }
    }

    let downloadSuccess = false;
    for (const url of urlsToTry) {
        if (!url || !url.startsWith('http')) continue;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                console.log(`[Local Stitch] Downloading scene ${s.current_index + 1} (attempt ${attempt}) from: ${url}`);
                const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
                if (res.ok) {
                    const buf = Buffer.from(await res.arrayBuffer());
                    if (buf.length > 1000) {
                        fs.writeFileSync(tempPath, buf);
                        downloadSuccess = true;
                        break;
                    }
                }
            } catch (fetchErr: any) {
                console.warn(`[Local Stitch] Scene download attempt ${attempt} failed for ${url}:`, fetchErr.message);
            }
        }
        if (downloadSuccess) break;
    }

    // Emergency Fallback: If R2 failed or returned 404, query Kie.ai directly using the original task ID!
    if (!downloadSuccess && s.last_task_id && process.env.KIE_API_KEY) {
        console.log(`[Local Stitch] Primary URL failed for scene ${s.current_index + 1}. Attempting emergency Kie API lookup: ${s.last_task_id}`);
        try {
            const kieRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${s.last_task_id}`, {
                headers: { 'Authorization': `Bearer ${process.env.KIE_API_KEY}` },
                signal: AbortSignal.timeout(10000)
            });
            if (kieRes.ok) {
                const kieData = await kieRes.json();
                const kieVideoUrl = kieData?.data?.response?.resultUrls?.[0] ||
                    (kieData?.data?.resultJson ? JSON.parse(kieData.data.resultJson)?.resultUrls?.[0] : null);
                if (kieVideoUrl && typeof kieVideoUrl === 'string' && kieVideoUrl.startsWith('http')) {
                    console.log(`[Local Stitch] Recovered direct Kie video URL for scene ${s.current_index + 1}: ${kieVideoUrl}`);
                    const directRes = await fetch(kieVideoUrl, { signal: AbortSignal.timeout(30000) });
                    if (directRes.ok) {
                        const buf = Buffer.from(await directRes.arrayBuffer());
                        if (buf.length > 1000) {
                            fs.writeFileSync(tempPath, buf);
                            downloadSuccess = true;
                        }
                    }
                }
            }
        } catch (kieErr: any) {
            console.error(`[Local Stitch] Emergency Kie fallback failed for scene ${s.current_index + 1}:`, kieErr.message);
        }
    }

    if (!downloadSuccess) {
        throw new Error(`Failed to download scene clip ${s.current_index + 1} (${s.last_successful_task_id}) from any source.`);
    }
}

/**
 * Probes the exact duration of an MP4 clip using FFprobe.
 */
async function probeClipDuration(clipPath: string, ffprobeExec: string): Promise<number> {
    try {
        const probeResult = await new Promise<string>((resolve, reject) => {
            exec(
                `"${ffprobeExec}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${clipPath}"`,
                (err, stdout) => {
                    if (err) reject(err);
                    else resolve(stdout.trim());
                }
            );
        });
        const dur = parseFloat(probeResult);
        if (!isNaN(dur) && dur > 1) {
            return dur;
        }
    } catch (_) {}
    return 15.0; // fallback standard 15s clip
}

/**
 * Performs fast direct FFmpeg stitching locally or inside the serverless execution environment.
 * Applies smooth cinematic xfade transitions between multi-clip scenes,
 * replaces clip audio with the voiceover stream (-map [v] -map N:a:0) and uploads to R2.
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
        // 1. Download all scene clips with resilient fallback
        const localClipPaths: string[] = [];
        for (let idx = 0; idx < siblings.length; idx++) {
            const s = siblings[idx];
            const clipPath = path.join(tempStitchDir, `scene_${idx}.mp4`);
            await downloadSceneClipResiliently(s, clipPath);
            localClipPaths.push(clipPath);
        }

        // 2. Concat list (for fallback or single clip)
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
        const ffprobeExec = getFfprobePath();
        const outputPath = path.join(tempStitchDir, 'final_stitched.mp4');

        // Check if multi-clip transition is possible
        let stitchCompleted = false;

        // Probe audio duration if voiceover is present
        let audioDuration = 0;
        if (localAudioPath) {
            try {
                audioDuration = await probeClipDuration(localAudioPath, ffprobeExec);
                console.log(`[Local Stitch] Probed voiceover audio duration: ${audioDuration.toFixed(2)}s`);
            } catch (audErr) {
                console.warn(`[Local Stitch] Failed to probe audio duration:`, audErr);
            }
        }

        if (localClipPaths.length > 1) {
            try {
                console.log(`[Local Stitch] Attempting cinematic xfade crossfade transitions across ${localClipPaths.length} clips...`);
                const durations: number[] = [];
                for (const p of localClipPaths) {
                    const d = await probeClipDuration(p, ffprobeExec);
                    durations.push(d);
                }
                console.log(`[Local Stitch] Probed clip durations for transitions:`, durations);

                const transitionDuration = 0.4;

                // Calculate raw total video duration with crossfades
                let rawOffset = 0;
                for (let i = 1; i < localClipPaths.length; i++) {
                    if (i === 1) {
                        rawOffset = Math.max(0.5, durations[0] - transitionDuration);
                    } else {
                        rawOffset = Math.max(0.5, rawOffset + durations[i - 1] - transitionDuration);
                    }
                }
                const rawTotalVideoDuration = rawOffset + durations[durations.length - 1];
                console.log(`[Local Stitch] Raw total video duration: ${rawTotalVideoDuration.toFixed(2)}s`);

                let effectiveDurations = [...durations];
                let shouldTrimToAudio = false;
                let targetTotalDuration = rawTotalVideoDuration;

                if (audioDuration > 0 && (rawTotalVideoDuration - audioDuration) > 1.0) {
                    // Video duration significantly exceeds voiceover:
                    // Proportionately scale clip durations so all scenes get balanced airtime across the voiceover,
                    // with a natural 0.8s breath and smooth outro fade, eliminating awkward trailing silence!
                    shouldTrimToAudio = true;
                    targetTotalDuration = audioDuration + 0.8;
                    const targetClipDur = (targetTotalDuration + (localClipPaths.length - 1) * transitionDuration) / localClipPaths.length;
                    effectiveDurations = durations.map(d => Math.min(d, targetClipDur));
                    console.log(`[Local Stitch] Video (${rawTotalVideoDuration.toFixed(2)}s) exceeds voiceover (${audioDuration.toFixed(2)}s). Proportionately scaling ${localClipPaths.length} clips to ${targetClipDur.toFixed(2)}s each (target total: ${targetTotalDuration.toFixed(2)}s) with zero trailing silence...`);
                }

                const filterParts: string[] = [];
                let currentStream = '[0:v]';
                let currentOffset = 0;

                for (let i = 1; i < localClipPaths.length; i++) {
                    if (i === 1) {
                        currentOffset = Math.max(0.5, effectiveDurations[0] - transitionDuration);
                    } else {
                        currentOffset = Math.max(0.5, currentOffset + effectiveDurations[i - 1] - transitionDuration);
                    }
                    const nextStream = i === localClipPaths.length - 1 ? '[v_trans]' : `[v${i}]`;
                    filterParts.push(`${currentStream}[${i}:v]xfade=transition=fade:duration=${transitionDuration}:offset=${currentOffset.toFixed(2)}${nextStream}`);
                    currentStream = nextStream;
                }

                const totalVideoDuration = currentOffset + effectiveDurations[effectiveDurations.length - 1];
                console.log(`[Local Stitch] Estimated video duration after xfade: ${totalVideoDuration.toFixed(2)}s`);

                let finalVideoStream = '[v_trans]';
                let finalAudioStream = `${localClipPaths.length}:a:0`;

                if (audioDuration > rawTotalVideoDuration) {
                    // Voiceover exceeds video: pad last video frame so narration completes without cutoff
                    const padDuration = (audioDuration - rawTotalVideoDuration) + 0.35;
                    console.log(`[Local Stitch] Audio (${audioDuration.toFixed(2)}s) exceeds video (${rawTotalVideoDuration.toFixed(2)}s). Extending last video frame by ${padDuration.toFixed(2)}s using tpad...`);
                    filterParts.push(`[v_trans]tpad=stop_mode=clone:stop_duration=${padDuration.toFixed(2)}[v_padded]`);
                    finalVideoStream = '[v_padded]';
                } else if (shouldTrimToAudio) {
                    // Voiceover ended early: trim cleanly to targetTotalDuration with smooth 0.5s fade out
                    const fadeStart = Math.max(0, targetTotalDuration - 0.5);
                    console.log(`[Local Stitch] Trimming video stream to ${targetTotalDuration.toFixed(2)}s with outro fade from ${fadeStart.toFixed(2)}s...`);
                    filterParts.push(`[v_trans]trim=0:${targetTotalDuration.toFixed(2)},setpts=PTS-STARTPTS,fade=t=out:st=${fadeStart.toFixed(2)}:d=0.5[v_trimmed]`);
                    finalVideoStream = '[v_trimmed]';
                    if (localAudioPath) {
                        filterParts.push(`[${localClipPaths.length}:a:0]atrim=0:${targetTotalDuration.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart.toFixed(2)}:d=0.5[a_faded]`);
                        finalAudioStream = '[a_faded]';
                    }
                }

                // Enforce 9:16 portrait output if aspect_ratio is 9:16 (the default standard)
                if (videoTask.aspect_ratio === '9:16' || !videoTask.aspect_ratio) {
                    filterParts.push(`${finalVideoStream}scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[v_portrait]`);
                    finalVideoStream = '[v_portrait]';
                }

                const filterComplex = filterParts.join(';');
                const inputsStr = localClipPaths.map(p => `-i "${p}"`).join(' ');

                const xfadeCmd = localAudioPath
                    ? `"${ffmpegExec}" -nostdin -y ${inputsStr} -i "${localAudioPath}" -filter_complex "${filterComplex}" -map "${finalVideoStream}" -map "${finalAudioStream}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`
                    : `"${ffmpegExec}" -nostdin -y ${inputsStr} -filter_complex "${filterComplex}" -map "${finalVideoStream}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -movflags +faststart "${outputPath}"`;

                console.log(`[Local Stitch] Executing FFmpeg xfade transition command: ${xfadeCmd}`);
                await new Promise<void>((resolve, reject) => {
                    exec(xfadeCmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr, stdout, stderr) => {
                        if (execErr) {
                            console.warn(`[Local Stitch] xfade transition failed:`, stderr || execErr);
                            reject(execErr);
                        } else {
                            resolve();
                        }
                    });
                });

                if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
                    stitchCompleted = true;
                    console.log(`[Local Stitch] xfade transitions successfully rendered to final MP4! 🎬`);
                }
            } catch (xfadeErr: any) {
                console.warn(`[Local Stitch] xfade transition execution encountered an issue. Falling back to direct stream concat:`, xfadeErr?.message || xfadeErr);
            }
        }

        // Fallback or single-clip execution: fast concat demuxer
        if (!stitchCompleted) {
            let totalFallbackDuration = 0;
            for (const p of localClipPaths) {
                try {
                    totalFallbackDuration += await probeClipDuration(p, ffprobeExec);
                } catch {}
            }

            let ffmpegCmd: string;
            const is9x16 = videoTask.aspect_ratio === '9:16' || !videoTask.aspect_ratio;
            const filter9x16 = is9x16 ? 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280' : '';

            if (localAudioPath && audioDuration > totalFallbackDuration && totalFallbackDuration > 0) {
                const padDuration = (audioDuration - totalFallbackDuration) + 0.35;
                console.log(`[Local Stitch Fallback] Audio (${audioDuration.toFixed(2)}s) exceeds video (${totalFallbackDuration.toFixed(2)}s). Extending with tpad clone by ${padDuration.toFixed(2)}s...`);
                const vf = filter9x16 ? `[0:v]tpad=stop_mode=clone:stop_duration=${padDuration.toFixed(2)},${filter9x16}[v]` : `[0:v]tpad=stop_mode=clone:stop_duration=${padDuration.toFixed(2)}[v]`;
                ffmpegCmd = `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -i "${localAudioPath}" -filter_complex "${vf}" -map "[v]" -map 1:a:0 -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
            } else if (localAudioPath && audioDuration > 0 && totalFallbackDuration > audioDuration + 1.0) {
                const targetDur = audioDuration + 0.8;
                const fadeStart = Math.max(0, targetDur - 0.5);
                console.log(`[Local Stitch Fallback] Video (${totalFallbackDuration.toFixed(2)}s) exceeds audio (${audioDuration.toFixed(2)}s). Trimming video to ${targetDur.toFixed(2)}s with outro fade...`);
                const vfilter = filter9x16 
                    ? `[0:v]trim=0:${targetDur.toFixed(2)},setpts=PTS-STARTPTS,fade=t=out:st=${fadeStart.toFixed(2)}:d=0.5,${filter9x16}[v]`
                    : `[0:v]trim=0:${targetDur.toFixed(2)},setpts=PTS-STARTPTS,fade=t=out:st=${fadeStart.toFixed(2)}:d=0.5[v]`;
                const filterComplex = `${vfilter};[1:a]atrim=0:${targetDur.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart.toFixed(2)}:d=0.5[a]`;
                ffmpegCmd = `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -i "${localAudioPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
            } else if (localAudioPath) {
                if (filter9x16) {
                    ffmpegCmd = `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -i "${localAudioPath}" -filter_complex "[0:v]${filter9x16}[v]" -map "[v]" -map 1:a:0 -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
                } else {
                    ffmpegCmd = `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -i "${localAudioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
                }
            } else {
                if (filter9x16) {
                    ffmpegCmd = `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -filter_complex "[0:v]${filter9x16}[v]" -map "[v]" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -movflags +faststart "${outputPath}"`;
                } else {
                    ffmpegCmd = `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -c copy -movflags +faststart "${outputPath}"`;
                }
            }

            console.log(`[Local Stitch] Executing direct stream concat FFmpeg command: ${ffmpegCmd}`);
            await new Promise<void>((resolve, reject) => {
                exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr, stdout, stderr) => {
                    if (execErr) {
                        console.error(`[Local Stitch] FFmpeg fallback error:`, stderr || execErr);
                        reject(execErr);
                    } else {
                        resolve();
                    }
                });
            });
        }

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

        // 5. Generate crisp thumbnail
        let thumbnailUrl: string | null = null;
        try {
            thumbnailUrl = await generateAndUploadVideoThumbnail(outputPath, videoTask.user_id, videoTask.asset_id);
        } catch (thumbErr) {
            console.error("[Local Stitch] Thumbnail generation error:", thumbErr);
        }

        // 6. Update Supabase asset safely merging metadata
        if (videoTask.asset_id) {
            const { data: existingAsset } = await supabaseAdmin
                .from('assets')
                .select('metadata')
                .eq('id', videoTask.asset_id)
                .single();

            const mergedMeta = {
                ...(existingAsset?.metadata || {}),
                ...(thumbnailUrl ? { thumbnailUrl } : {}),
                ...(audioUrl ? { audioUrl } : {}),
                videoModel: 'grok'
            };

            await supabaseAdmin.from('assets').update({
                url: finalR2Url,
                status: 'Ready',
                metadata: mergedMeta
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
