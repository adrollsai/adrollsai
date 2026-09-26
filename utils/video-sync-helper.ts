import { createClient as createAdminClient } from '@supabase/supabase-js';
import { renderMediaOnLambda } from '@remotion/lambda';
import { speculateFunctionName } from '@remotion/lambda-client';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { sendPushNotification } from '@/utils/notification-helper';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { resolveVoiceoverAudio } from '@/utils/video-voiceover-helper';
import { getFfmpegPath, getFfprobePath } from '@/utils/ffmpeg-helper';
import { dispatchCloudRunStitch, stitchClipsLocally } from '@/utils/video-stitcher';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Bulletproof helper to extract video URL from Kie recordInfo JSON response.
 * Safely handles format changes, fallbacks, and nested data structures.
 */
export function extractVideoUrl(checkData: any): string | null {
    if (!checkData) return null;
    
    const result = checkData.result || checkData.data?.result || checkData.data;
    
    if (result) {
        // 1. Direct URL fields
        const url = result.video_url || 
                    result.videoUrl || 
                    result.output_url || 
                    result.outputUrl || 
                    result.url || 
                    result.imageUrl || 
                    result.image_url;

        if (url && typeof url === 'string' && url.startsWith('http')) {
            return url;
        }

        // 2. Prioritized callback formats (Arrays of URLs)
        const urls = result.videoUrls || 
                     result.resultUrls || 
                     result.result_urls || 
                     result.fullResultUrls || 
                     result.full_result_urls;
                     
        if (Array.isArray(urls) && urls.length > 0 && typeof urls[0] === 'string' && urls[0].startsWith('http')) {
            return urls[0];
        }
    }

    // 3. Fallback to resultJson field
    const resultJson = checkData.resultJson || checkData.data?.resultJson;
    if (resultJson) {
        try {
            const parsed = JSON.parse(resultJson);
            const parsedUrls = parsed.resultUrls || parsed.result_urls || parsed.fullResultUrls || parsed.full_result_urls || [parsed.url];
            const firstUrl = Array.isArray(parsedUrls) ? parsedUrls[0] : parsedUrls;
            if (firstUrl && typeof firstUrl === 'string' && firstUrl.startsWith('http')) {
                return firstUrl;
            }
        } catch (e) {
            console.error("[Video Sync] Error parsing resultJson:", e);
        }
    }

    // 4. Recursive search fallback: Find the first substring that looks like a video URL
    try {
        const jsonStr = JSON.stringify(checkData);
        const matches = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|mov|avi|webm)[^"]*)"/i);
        if (matches && matches.length > 1) {
            console.log(`[Video Sync] Regex-matched video URL: ${matches[1]}`);
            return matches[1];
        }
        
        // General URL search as a final resort
        const generalMatches = jsonStr.match(/"(https?:\/\/[^"]+)"/g);
        if (generalMatches) {
            for (const match of generalMatches) {
                const url = match.replace(/"/g, '');
                if (url.includes('.mp4') || url.includes('/generated/') || url.includes('kie.ai')) {
                    console.log(`[Video Sync] Recursive-matched general video URL: ${url}`);
                    return url;
                }
            }
        }
    } catch (e) {
        console.error("[Video Sync] Regex URL extraction error:", e);
    }

    return null;
}

export interface VideoSyncResult {
    taskId?: string;
    assetId?: string;
    status: string;
    error?: string;
}

/**
 * Synchronizes processing video tasks for one or multiple user IDs against Kie.ai.
 * Automatically fetches completed scenes, persists them to R2, and stitches when all scenes are ready.
 */
export async function syncVideoTasksForUser(
    targetUserIds: string | string[],
    baseUrl?: string
): Promise<{ success: boolean; synced: VideoSyncResult[] }> {
    const userIds = Array.isArray(targetUserIds) ? targetUserIds : [targetUserIds];
    if (userIds.length === 0) {
        return { success: true, synced: [] };
    }

    console.log(`[Video Sync Helper] Starting task sync for users: ${userIds.join(', ')}`);

    const { data: activeTasks, error: fetchError } = await supabaseAdmin
        .from('video_tasks')
        .select('*')
        .in('user_id', userIds)
        .eq('status', 'Processing');

    if (fetchError) {
        console.error("[Video Sync Helper] Error fetching video tasks:", fetchError);
        return { success: false, synced: [] };
    }

    const syncedResults: VideoSyncResult[] = [];

    if (activeTasks && activeTasks.length > 0) {
        console.log(`[Video Sync Helper] Found ${activeTasks.length} active tasks to synchronize.`);

        for (const task of activeTasks) {
            const taskId = task.last_task_id;
            if (!taskId) {
                console.warn(`[Video Sync Helper] Task ${task.id} has no last_task_id. Skipping.`);
                continue;
            }

            console.log(`[Video Sync Helper] Querying Kie.ai status for taskId: ${taskId}...`);

            try {
                const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${process.env.KIE_API_KEY}`
                    },
                    signal: AbortSignal.timeout(6000)
                });

                if (!response.ok) {
                    console.error(`[Video Sync Helper] Kie API returned non-OK status: ${response.statusText}`);
                    continue;
                }

                const checkData = await response.json();
                const status = checkData.status || checkData.data?.status || checkData.data?.state;

                if (status === 'succeeded' || status === 'completed' || status === 'success') {
                    console.log(`[Video Sync Helper] Task ${taskId} has succeeded on Kie.ai. Commencing finalization...`);
                    
                    const videoUrl = extractVideoUrl(checkData);

                    if (!videoUrl) {
                        console.error(`[Video Sync Helper] Succeeded status reported, but no video URL found in Kie response:`, JSON.stringify(checkData));
                        continue;
                    }

                    console.log(`[Video Sync Helper] Found video URL: ${videoUrl}. Persisting to R2...`);

                    // Fetch and upload scene video to R2
                    let persistedUrl = videoUrl;
                    try {
                        const videoRes = await fetch(videoUrl);
                        const buffer = Buffer.from(await videoRes.arrayBuffer());
                        const scenePrefix = task.asset_id ? `${task.asset_id}_` : '';
                        const fileName = `generated/${task.user_id}/${scenePrefix}scene_${task.current_index}.mp4`;
                        
                        await r2.send(new PutObjectCommand({
                            Bucket: R2_BUCKET,
                            Key: fileName,
                            Body: buffer,
                            ContentType: 'video/mp4'
                        }));
                        
                        persistedUrl = `${R2_PUBLIC_URL}/${fileName}`;
                        console.log(`[Video Sync Helper] Successfully uploaded scene to R2: ${persistedUrl}`);
                    } catch (r2Error) {
                        console.error("[Video Sync Helper] R2 upload failed. Falling back to direct Kie URL.", r2Error);
                    }

                    // Update task in video_tasks to Completed
                    await supabaseAdmin
                        .from('video_tasks')
                        .update({
                            status: 'Completed',
                            last_successful_task_id: persistedUrl
                        })
                        .eq('id', task.id);

                    // Check if all sibling tasks sharing the same asset_id are complete
                    const { data: siblings, error: siblingsError } = await supabaseAdmin
                        .from('video_tasks')
                        .select('*')
                        .eq('asset_id', task.asset_id);

                    if (siblingsError) {
                        console.error("[Video Sync Helper] Error fetching sibling tasks:", siblingsError);
                        continue;
                    }

                    const allCompleted = siblings && siblings.length > 0 && siblings.every(s => s.status === 'Completed');

                    if (!allCompleted) {
                        console.log(`[Video Sync Helper] Scene ${task.current_index + 1} completed via Sync. Waiting for other scene(s) to complete...`);
                        syncedResults.push({ taskId, assetId: task.asset_id, status: 'scene_completed_waiting' });
                        continue;
                    }

                    // All scenes completed! Stitch them!
                    siblings.sort((a, b) => a.current_index - b.current_index);

                    const finalAudioUrl = await resolveVoiceoverAudio(task, task.asset_id);
                    const hasVoiceover = !!finalAudioUrl;

                    console.log(`[Video Sync Helper] Resolved voiceover audio for Asset ${task.asset_id}: ${finalAudioUrl || 'None'}`);

                    // 1. Single scene AND no voiceover
                    if (siblings.length === 1 && !hasVoiceover) {
                        const clipUrl = siblings[0].last_successful_task_id;
                        let finalUrl = clipUrl;
                        
                        const tempDir = path.join(os.tmpdir(), `faststart_${task.asset_id}`);
                        try {
                            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                            const localPath = path.join(tempDir, `input.mp4`);
                            const outputPath = path.join(tempDir, `output.mp4`);
                            
                            const res = await fetch(clipUrl);
                            if (res.ok) {
                                const buffer = Buffer.from(await res.arrayBuffer());
                                fs.writeFileSync(localPath, buffer);

                                const ffmpegBinary = getFfmpegPath();
                                const cmd = `"${ffmpegBinary}" -nostdin -y -loglevel error -i "${localPath}" -c copy -movflags +faststart "${outputPath}"`;
                                
                                await new Promise<void>((resolvePromise, rejectPromise) => {
                                    exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr) => {
                                        if (execErr) rejectPromise(execErr);
                                        else resolvePromise();
                                    });
                                });
                                
                                const faststartBuffer = fs.readFileSync(outputPath);
                                const finalFileName = `generated/${task.user_id}/faststart_${Date.now()}.mp4`;
                                await r2.send(new PutObjectCommand({
                                    Bucket: R2_BUCKET,
                                    Key: finalFileName,
                                    Body: faststartBuffer,
                                    ContentType: 'video/mp4'
                                }));
                                finalUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
                            }
                        } catch (faststartErr) {
                            console.error("[Video Sync Helper] Faststart process failed, using original:", faststartErr);
                        } finally {
                            try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
                        }

                        if (task.asset_id) {
                            await supabaseAdmin.from('assets').update({
                                url: finalUrl,
                                status: 'Ready'
                            }).eq('id', task.asset_id);
                        }
                        
                        await supabaseAdmin.from('video_tasks').delete().eq('asset_id', task.asset_id);
                        await sendPushNotification(
                            task.user_id, 
                            `🎬 15s Video Creative Ready!`, 
                            `Your 15-second AI video ad has been generated successfully.`, 
                            "/dashboard/assets", 
                            "asset_ready"
                        ).catch(() => {});
                        
                        syncedResults.push({ taskId, assetId: task.asset_id, status: 'succeeded' });
                        continue;
                    }

                    // 2. Single clip WITH voiceover
                    if (siblings.length === 1 && hasVoiceover && finalAudioUrl) {
                        const clipUrl = siblings[0].last_successful_task_id;
                        const tempDir = path.join(os.tmpdir(), `mux_${task.asset_id}_${Date.now()}`);
                        let muxSuccess = false;
                        let finalUrl = clipUrl;

                        try {
                            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                            const localPath = path.join(tempDir, `input.mp4`);
                            const audioPath = path.join(tempDir, `voiceover.mp3`);
                            const outputPath = path.join(tempDir, `output.mp4`);

                            const [vRes, aRes] = await Promise.all([fetch(clipUrl), fetch(finalAudioUrl)]);
                            if (vRes.ok && aRes.ok) {
                                fs.writeFileSync(localPath, Buffer.from(await vRes.arrayBuffer()));
                                fs.writeFileSync(audioPath, Buffer.from(await aRes.arrayBuffer()));

                                const ffmpegBinary = getFfmpegPath();
                                const ffprobeBinary = getFfprobePath();
                                try {
                                    const audOut = await new Promise<string>((res) => exec(`"${ffprobeBinary}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`, (_, out) => res(out || '')));
                                    audDur = parseFloat(audOut.trim()) || 0;
                                    const vidOut = await new Promise<string>((res) => exec(`"${ffprobeBinary}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localPath}"`, (_, out) => res(out || '')));
                                    vidDur = parseFloat(vidOut.trim()) || 0;
                                } catch {}

                                // Resilient FFmpeg -i fallback if ffprobe was missing or returned 0
                                if (audDur <= 0) {
                                    try {
                                        const ffmpegOut = await new Promise<string>((res) => exec(`"${ffmpegBinary}" -i "${audioPath}"`, (_, __, stderr) => res(stderr || '')));
                                        const m = ffmpegOut.match(/Duration:\s*(\d+):(\d+):([\d\.]+)/);
                                        if (m) audDur = parseFloat(m[1]) * 3600 + parseFloat(m[2]) * 60 + parseFloat(m[3]);
                                    } catch {}
                                }
                                if (vidDur <= 0) {
                                    try {
                                        const ffmpegOut = await new Promise<string>((res) => exec(`"${ffmpegBinary}" -i "${localPath}"`, (_, __, stderr) => res(stderr || '')));
                                        const m = ffmpegOut.match(/Duration:\s*(\d+):(\d+):([\d\.]+)/);
                                        if (m) vidDur = parseFloat(m[1]) * 3600 + parseFloat(m[2]) * 60 + parseFloat(m[3]);
                                    } catch {}
                                }

                                let cmd: string;
                                if (audDur > vidDur && vidDur > 0) {
                                    const pad = (audDur - vidDur) + 0.35;
                                    cmd = `"${ffmpegBinary}" -nostdin -y -i "${localPath}" -i "${audioPath}" -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}[v]" -map "[v]" -map 1:a:0 -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
                                } else if (audDur > 0 && vidDur > audDur + 1.0) {
                                    const targetDur = audDur + 0.8;
                                    const fadeStart = Math.max(0, targetDur - 0.5);
                                    cmd = `"${ffmpegBinary}" -nostdin -y -i "${localPath}" -i "${audioPath}" -filter_complex "[0:v]trim=0:${targetDur.toFixed(2)},setpts=PTS-STARTPTS,fade=t=out:st=${fadeStart.toFixed(2)}:d=0.5[v];[1:a]atrim=0:${targetDur.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart.toFixed(2)}:d=0.5[a]" -map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
                                } else {
                                    cmd = `"${ffmpegBinary}" -nostdin -y -i "${localPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
                                }

                                await new Promise<void>((resolvePromise, rejectPromise) => {
                                    exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr) => {
                                        if (execErr) rejectPromise(execErr);
                                        else resolvePromise();
                                    });
                                });

                                if (fs.existsSync(outputPath)) {
                                    const muxBuffer = fs.readFileSync(outputPath);
                                    const finalFileName = `generated/${task.user_id}/stitched_${Date.now()}.mp4`;
                                    await r2.send(new PutObjectCommand({
                                        Bucket: R2_BUCKET,
                                        Key: finalFileName,
                                        Body: muxBuffer,
                                        ContentType: 'video/mp4'
                                    }));
                                    finalUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
                                    muxSuccess = true;
                                }
                            }
                        } catch (singleMuxErr: any) {
                            console.warn(`[Video Sync Helper] Local single-clip mux failed:`, singleMuxErr.message);
                        } finally {
                            try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
                        }

                        if (muxSuccess) {
                            if (task.asset_id) {
                                await supabaseAdmin.from('assets').update({
                                    url: finalUrl,
                                    status: 'Ready',
                                    metadata: { audioUrl: finalAudioUrl }
                                }).eq('id', task.asset_id);
                            }
                            await supabaseAdmin.from('video_tasks').delete().eq('asset_id', task.asset_id);
                            await sendPushNotification(
                                task.user_id, 
                                `🎬 15s Video Creative Ready!`, 
                                `Your 15-second AI video ad with voiceover has been generated successfully.`, 
                                "/dashboard/assets", 
                                "asset_ready"
                            ).catch(() => {});
                            syncedResults.push({ taskId, assetId: task.asset_id, status: 'succeeded' });
                            continue;
                        }
                    }

                    // 3. Fast direct local FFmpeg stitch first
                    try {
                        console.log(`[Video Sync Helper] Starting fast local FFmpeg stitching for Asset ID ${task.asset_id}...`);
                        await stitchClipsLocally(
                            siblings.map(s => ({
                                current_index: s.current_index,
                                last_successful_task_id: s.last_successful_task_id,
                                last_task_id: s.last_task_id
                            })),
                            { asset_id: task.asset_id, user_id: task.user_id, prompts: task.prompts },
                            finalAudioUrl,
                            supabaseAdmin
                        );
                        syncedResults.push({ taskId, assetId: task.asset_id, status: 'succeeded' });
                        continue;
                    } catch (fastFfmpegErr: any) {
                        console.warn(`[Video Sync Helper] Fast local FFmpeg stitching failed, attempting Cloud Run worker:`, fastFfmpegErr?.message || fastFfmpegErr);
                    }

                    // 4. Cloud Run Stitcher Worker fallback
                    try {
                        console.log(`[Video Sync Helper] Attempting stitch via Cloud Run worker for Asset ID ${task.asset_id}...`);
                        const cloudRunSuccess = await dispatchCloudRunStitch(
                            siblings.map(s => ({
                                current_index: s.current_index,
                                last_successful_task_id: s.last_successful_task_id,
                                last_task_id: s.last_task_id
                            })),
                            { asset_id: task.asset_id, user_id: task.user_id, prompts: task.prompts },
                            finalAudioUrl
                        );

                        if (cloudRunSuccess) {
                            console.log(`[Video Sync Helper] Stitch successfully handed off to Cloud Run for Asset ${task.asset_id}.`);
                            if (task.asset_id) {
                                await supabaseAdmin.from('assets').update({ status: 'Rendering' }).eq('id', task.asset_id);
                            }
                            syncedResults.push({ taskId, assetId: task.asset_id, status: 'rendering_cloud_run' });
                            continue;
                        }
                    } catch (cloudRunErr: any) {
                        console.warn(`[Video Sync Helper] Cloud Run stitch dispatch error:`, cloudRunErr.message);
                    }

                    // 5. AWS Remotion Lambda fallback
                    try {
                        const effectiveBase = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
                        const callbackUrl = `${effectiveBase}/api/video/render/callback`;

                        const functionName = speculateFunctionName({
                            diskSizeInMb: 2048,
                            memorySizeInMb: 3008,
                            timeoutInSeconds: 240,
                        });

                        const bucketName = process.env.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
                        const siteName = process.env.REMOTION_AWS_SITE_NAME || 'nobogent-site';
                        const region = (process.env.REMOTION_AWS_REGION || 'us-east-1') as any;

                        const totalFrames = siblings.length * 15 * 30;
                        const framesPerLambda = Math.max(250, Math.ceil(totalFrames / 3));

                        const renderResult = await renderMediaOnLambda({
                            region,
                            functionName,
                            serveUrl: `https://${bucketName}.s3.${region}.amazonaws.com/sites/${siteName}/index.html`,
                            composition: 'StitchComposition',
                            inputProps: {
                                videoUrls: siblings.map(s => s.last_successful_task_id),
                                ...(finalAudioUrl ? { audioUrl: finalAudioUrl } : {})
                            },
                            codec: 'h264',
                            imageFormat: 'jpeg',
                            maxRetries: 2,
                            privacy: 'public',
                            framesPerLambda,
                            forceDurationInFrames: totalFrames,
                            webhook: {
                                url: callbackUrl,
                                secret: null,
                                customData: {
                                    assetId: task.asset_id,
                                    isStitch: true
                                }
                            }
                        });

                        if (task.asset_id) {
                            await supabaseAdmin.from('assets').update({ status: 'Rendering' }).eq('id', task.asset_id);
                        }

                        syncedResults.push({ taskId, assetId: task.asset_id, status: 'rendering_stitch' });
                        continue;

                    } catch (stitchErr: any) {
                        console.error("[Video Sync Helper] Lambda stitching dispatch failed:", stitchErr);
                        if (task.asset_id) {
                            await supabaseAdmin.from('assets').update({ 
                                status: 'Failed',
                                metadata: { error: `Stitching dispatch failed: ${stitchErr.message}` }
                            }).eq('id', task.asset_id);
                            await supabaseAdmin.from('video_tasks').delete().eq('asset_id', task.asset_id);
                        }
                        syncedResults.push({ taskId, assetId: task.asset_id, status: 'failed', error: stitchErr.message });
                        continue;
                    }

                } else if (status === 'failed' || status === 'error') {
                    const failReason = checkData.failMsg || checkData.error || checkData.msg || "Unknown Kie.ai Error";
                    console.error(`[Video Sync Helper] Task ${taskId} failed on Kie.ai: ${failReason}`);

                    if (task.asset_id) {
                        await supabaseAdmin
                            .from('assets')
                            .update({ 
                                status: 'Failed',
                                metadata: { error: failReason }
                            })
                            .eq('id', task.asset_id);
                    }

                    await supabaseAdmin.from('video_tasks').delete().eq('asset_id', task.asset_id);
                    syncedResults.push({ taskId, assetId: task.asset_id, status: 'failed', error: failReason });
                } else {
                    syncedResults.push({ taskId, assetId: task.asset_id, status: 'processing' });
                }

            } catch (taskErr: any) {
                console.error(`[Video Sync Helper] Error synchronizing task ${taskId}:`, taskErr.message);
            }
        }
    }

    // Self-Healing Recovery: detect completed scenes whose parent asset is still stuck in processing
    try {
        const { data: allUserTasks } = await supabaseAdmin
            .from('video_tasks')
            .select('*')
            .in('user_id', userIds);

        if (allUserTasks && allUserTasks.length > 0) {
            const tasksByAsset = new Map<string, any[]>();
            for (const t of allUserTasks) {
                if (!t.asset_id) continue;
                if (!tasksByAsset.has(t.asset_id)) tasksByAsset.set(t.asset_id, []);
                tasksByAsset.get(t.asset_id)!.push(t);
            }

            for (const [assetId, siblings] of tasksByAsset.entries()) {
                const allCompleted = siblings.length > 0 && siblings.every(s => s.status === 'Completed' && s.last_successful_task_id);
                if (allCompleted) {
                    const { data: assetRec } = await supabaseAdmin
                        .from('assets')
                        .select('id, url, status')
                        .eq('id', assetId)
                        .single();

                    if (assetRec && (assetRec.url?.includes('/processing') || ['Processing', 'Rendering'].includes(assetRec.status))) {
                        console.log(`[Video Sync Helper] 🚑 Self-Healing Recovery triggered for Asset ${assetId}`);
                        siblings.sort((a, b) => a.current_index - b.current_index);
                        const finalAudioUrl = await resolveVoiceoverAudio(siblings[0], assetId);

                        try {
                            await stitchClipsLocally(
                                siblings.map(s => ({
                                    current_index: s.current_index,
                                    last_successful_task_id: s.last_successful_task_id,
                                    last_task_id: s.last_task_id
                                })),
                                { asset_id: assetId, user_id: siblings[0].user_id, prompts: siblings[0].prompts },
                                finalAudioUrl,
                                supabaseAdmin
                            );
                            syncedResults.push({ assetId, status: 'recovered_and_stitched' });
                        } catch (recoveryErr: any) {
                            console.error(`[Video Sync Helper] Self-healing stitch attempt failed:`, recoveryErr.message);
                        }
                    }
                }
            }
        }
    } catch (healErr: any) {
        console.error("[Video Sync Helper] Self-healing scan warning:", healErr.message);
    }

    return { success: true, synced: syncedResults };
}
