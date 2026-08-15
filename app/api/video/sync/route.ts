import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/utils/supabase/server';
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

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Bulletproof helper to extract video URL from Kie recordInfo JSON response.
 * Safely handles format changes, fallbacks, and nested data structures.
 */
function extractVideoUrl(checkData: any): string | null {
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
            console.error("[Sync Endpoint] Error parsing resultJson:", e);
        }
    }

    // 4. Recursive search fallback: Find the first substring that looks like a video URL
    try {
        const jsonStr = JSON.stringify(checkData);
        const matches = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|mov|avi|webm)[^"]*)"/i);
        if (matches && matches.length > 1) {
            console.log(`[Sync Endpoint] Regex-matched video URL: ${matches[1]}`);
            return matches[1];
        }
        
        // General URL search as a final resort
        const generalMatches = jsonStr.match(/"(https?:\/\/[^"]+)"/g);
        if (generalMatches) {
            for (const match of generalMatches) {
                const url = match.replace(/"/g, '');
                if (url.includes('.mp4') || url.includes('/generated/') || url.includes('kie.ai')) {
                    console.log(`[Sync Endpoint] Recursive-matched general video URL: ${url}`);
                    return url;
                }
            }
        }
    } catch (e) {
        console.error("[Sync Endpoint] Regex URL extraction error:", e);
    }

    return null;
}

export async function POST(request: Request) {
    console.log("[Sync Endpoint] Proactive task synchronization initiated.");

    try {
        // 1. Authenticate user
        const supabase = await createServerClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Parse impersonate ID from request URL
        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');

        const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single();
        let targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
          ? (currentProfile.agency_id || currentProfile.parent_id) 
          : user.id;

        if (impersonateId) {
            if (['super_admin', 'agency', 'admin'].includes(currentProfile?.role || '')) {
                if (currentProfile?.role !== 'super_admin') {
                    const isParent = (currentProfile?.agency_id === impersonateId || currentProfile?.parent_id === impersonateId);
                    const { data: subAccount } = await supabase
                      .from('profiles')
                      .select('id')
                      .eq('id', impersonateId)
                      .eq('agency_id', currentProfile?.agency_id || user.id)
                      .single();

                    if (isParent || subAccount) {
                        targetUserId = impersonateId;
                    } else {
                        return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
                    }
                } else {
                    targetUserId = impersonateId;
                }
            } else {
                return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
            }
        }

        console.log(`[Sync Endpoint] Querying tasks for target user: ${targetUserId} (impersonated: ${!!impersonateId})`);

        // 2. Fetch processing video tasks for the target user
        const { data: activeTasks, error: fetchError } = await supabaseAdmin
            .from('video_tasks')
            .select('*')
            .eq('user_id', targetUserId)
            .eq('status', 'Processing');

        if (fetchError) {
            console.error("[Sync Endpoint] Error fetching video tasks:", fetchError);
            return NextResponse.json({ error: 'Database fetch error' }, { status: 500 });
        }

        if (!activeTasks || activeTasks.length === 0) {
            console.log("[Sync Endpoint] No active processing tasks to sync.");
            return NextResponse.json({ success: true, synced: [] });
        }

        console.log(`[Sync Endpoint] Found ${activeTasks.length} active tasks to synchronize.`);
        const syncedResults = [];

        // 3. Proactively sync each task against Kie.ai
        for (const task of activeTasks) {
            const taskId = task.last_task_id;
            if (!taskId) {
                console.warn(`[Sync Endpoint] Task ${task.id} has no last_task_id. Skipping.`);
                continue;
            }

            console.log(`[Sync Endpoint] Querying Kie.ai status for taskId: ${taskId}...`);
            
            try {
                const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${process.env.KIE_API_KEY}`
                    }
                });

                if (!response.ok) {
                    console.error(`[Sync Endpoint] Kie API returned non-OK status: ${response.statusText}`);
                    continue;
                }

                const checkData = await response.json();
                console.log(`[Sync Endpoint] Kie response status for task ${taskId}:`, JSON.stringify(checkData.status || checkData.data?.status || checkData.data?.state));

                const status = checkData.status || checkData.data?.status || checkData.data?.state;

                if (status === 'succeeded' || status === 'completed' || status === 'success') {
                    console.log(`[Sync Endpoint] Task ${taskId} has succeeded on Kie.ai. Commencing finalization...`);
                    
                    const videoUrl = extractVideoUrl(checkData);

                    if (!videoUrl) {
                        console.error(`[Sync Endpoint] Succeeded status reported, but no video URL found in Kie response:`, JSON.stringify(checkData));
                        continue;
                    }

                    console.log(`[Sync Endpoint] Found video URL: ${videoUrl}. Persisting to R2...`);

                    // A. Fetch and upload video to R2
                    let persistedUrl = videoUrl;
                    try {
                        const videoRes = await fetch(videoUrl);
                        const buffer = Buffer.from(await videoRes.arrayBuffer());
                        const fileName = `generated/${task.user_id}/scene_${task.current_index}_${Date.now()}.mp4`;
                        
                        await r2.send(new PutObjectCommand({
                            Bucket: R2_BUCKET,
                            Key: fileName,
                            Body: buffer,
                            ContentType: 'video/mp4'
                        }));
                        
                        persistedUrl = `${R2_PUBLIC_URL}/${fileName}`;
                        console.log(`[Sync Endpoint] Successfully uploaded scene to R2: ${persistedUrl}`);
                    } catch (r2Error) {
                        console.error("[Sync Endpoint] R2 upload failed. Falling back to direct Kie URL.", r2Error);
                    }

                    // B. Update this task record in video_tasks to Completed
                    await supabaseAdmin
                        .from('video_tasks')
                        .update({
                            status: 'Completed',
                            last_successful_task_id: persistedUrl
                        })
                        .eq('id', task.id);

                    // C. Check if all sibling tasks sharing the same asset_id are complete
                    const { data: siblings, error: siblingsError } = await supabaseAdmin
                        .from('video_tasks')
                        .select('*')
                        .eq('asset_id', task.asset_id);

                    if (siblingsError) {
                        console.error("[Sync Endpoint] Error fetching sibling tasks:", siblingsError);
                        continue;
                    }

                    const allCompleted = siblings && siblings.length > 0 && siblings.every(s => s.status === 'Completed');

                    if (!allCompleted) {
                        console.log(`[Sync Endpoint] Scene ${task.current_index + 1} completed via Sync. Waiting for other scene(s) to complete...`);
                        syncedResults.push({ taskId, assetId: task.asset_id, status: 'scene_completed_waiting' });
                        continue;
                    }

                    // All scenes completed! Stitch them!
                    siblings.sort((a, b) => a.current_index - b.current_index);

                    // Resolve voiceover audio (resolves async TTS, checks asset metadata, profile audio, or synthesizes fallback TTS)
                    const finalAudioUrl = await resolveVoiceoverAudio(task, task.asset_id);
                    const hasVoiceover = !!finalAudioUrl;

                    console.log(`[Sync Endpoint] Resolved voiceover audio for Asset ${task.asset_id}: ${finalAudioUrl || 'None'}`);

                    // If there is only 1 scene AND no voiceover audio attached, bypass the stitcher and finalize the asset immediately on Vercel!
                    if (siblings.length === 1 && !hasVoiceover) {
                        const clipUrl = siblings[0].last_successful_task_id;
                        console.log(`[Sync Endpoint] Single-clip video detected (15s) with no voiceover. Finalizing asset: ${clipUrl}`);
                        
                        let finalUrl = clipUrl;
                        
                        // Run faststart pass to fix WhatsApp thumbnail issue
                        const tempDir = path.join(os.tmpdir(), `faststart_${task.asset_id}`);
                        try {
                            if (!fs.existsSync(tempDir)) {
                                fs.mkdirSync(tempDir, { recursive: true });
                            }
                            const localPath = path.join(tempDir, `input.mp4`);
                            const outputPath = path.join(tempDir, `output.mp4`);
                            
                            const res = await fetch(clipUrl);
                            if (!res.ok) throw new Error(`Failed to download scene for faststart`);
                            const buffer = Buffer.from(await res.arrayBuffer());
                            fs.writeFileSync(localPath, buffer);

                            const ffmpegBinary = path.join(
                                process.cwd(), 
                                'node_modules', 
                                'ffmpeg-static', 
                                os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
                            );

                            const cmd = `"${ffmpegBinary}" -nostdin -y -loglevel error -i "${localPath}" -c copy -movflags +faststart "${outputPath}"`;
                            console.log(`[Sync Endpoint] Running FFmpeg command: ${cmd}`);
                            
                            await new Promise<void>((resolvePromise, rejectPromise) => {
                                exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr) => {
                                    if (execErr) {
                                        rejectPromise(execErr);
                                    } else {
                                        resolvePromise();
                                    }
                                });
                            });
                            
                            // Upload faststart file to R2
                            const faststartBuffer = fs.readFileSync(outputPath);
                            const finalFileName = `generated/${task.user_id}/faststart_${Date.now()}.mp4`;
                            await r2.send(new PutObjectCommand({
                                Bucket: R2_BUCKET,
                                Key: finalFileName,
                                Body: faststartBuffer,
                                ContentType: 'video/mp4'
                            }));
                            finalUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
                            console.log(`[Sync Endpoint] Faststart single video uploaded to R2: ${finalUrl}`);
                        } catch (faststartErr) {
                            console.error("[Sync Endpoint] Faststart process failed, falling back to original clip URL:", faststartErr);
                        } finally {
                            try {
                                if (fs.existsSync(tempDir)) {
                                    fs.rmSync(tempDir, { recursive: true, force: true });
                                }
                            } catch (cleanupErr) {
                                console.error("[Sync Endpoint] Faststart cleanup failed:", cleanupErr);
                            }
                        }

                        if (task.asset_id) {
                            await supabaseAdmin.from('assets').update({
                                url: finalUrl,
                                status: 'Draft'
                            }).eq('id', task.asset_id);
                        }
                        
                        // Clean up tasks
                        await supabaseAdmin.from('video_tasks').delete().eq('asset_id', task.asset_id);
                        
                        // Send push notification
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

                    // Single clip WITH voiceover: try fast FFmpeg mux, otherwise let Remotion Lambda stitch it cleanly
                    if (siblings.length === 1 && hasVoiceover && finalAudioUrl) {
                        const clipUrl = siblings[0].last_successful_task_id;
                        console.log(`[Sync Endpoint] Single-clip video WITH voiceover detected (15s). Muxing audio: ${finalAudioUrl}`);
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

                                const ffmpegBinary = path.join(
                                    process.cwd(), 
                                    'node_modules', 
                                    'ffmpeg-static', 
                                    os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
                                );

                                const cmd = `"${ffmpegBinary}" -nostdin -y -i "${localPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
                                console.log(`[Sync Endpoint] Running FFmpeg single-clip voiceover mux command: ${cmd}`);

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
                                    console.log(`[Sync Endpoint] Single-clip with voiceover successfully uploaded to R2: ${finalUrl}`);
                                }
                            }
                        } catch (singleMuxErr: any) {
                            console.warn(`[Sync Endpoint] Local single-clip mux failed, falling back to AWS Lambda:`, singleMuxErr.message);
                        } finally {
                            try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
                        }

                        if (muxSuccess) {
                            if (task.asset_id) {
                                await supabaseAdmin.from('assets').update({
                                    url: finalUrl,
                                    status: 'Draft',
                                    metadata: {
                                        audioUrl: finalAudioUrl
                                    }
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

                    console.log(`[Sync Endpoint] All ${siblings.length} scenes completed. Initiating AWS Lambda stitching...`);
                    
                    try {
                        const forwardedHost = request.headers.get('x-forwarded-host');
                        const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
                        const requestOrigin = new URL(request.url).origin;
                        const publicUrl = process.env.NEXT_PUBLIC_APP_URL;
                        let baseUrl = requestOrigin;
                        
                        if (forwardedHost && !forwardedHost.includes('localhost')) {
                            baseUrl = `${forwardedProto}://${forwardedHost}`;
                        } else if (!requestOrigin.includes('localhost')) {
                            baseUrl = requestOrigin;
                        } else if (publicUrl && publicUrl.startsWith('http')) {
                            baseUrl = publicUrl;
                        }
                        
                        const callbackUrl = `${baseUrl.replace(/\/$/, '')}/api/video/render/callback`;
                        console.log(`[Sync Endpoint] Using callback URL for stitching: ${callbackUrl}`);

                        const functionName = speculateFunctionName({
                            diskSizeInMb: 512,
                            memorySizeInMb: 2048,
                            timeoutInSeconds: 900,
                        });

                        const bucketName = process.env.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
                        const siteName = process.env.REMOTION_AWS_SITE_NAME || 'nobogent-site';
                        const region = (process.env.REMOTION_AWS_REGION || 'us-east-1') as any;

                        // Use 250+ frames per Lambda (max 3 Lambdas total) to prevent Chromium remote video seeking stalls at chunk boundaries
                        const totalFrames = siblings.length * 15 * 30;
                        const maxLambdas = 3;
                        const framesPerLambda = Math.max(250, Math.ceil(totalFrames / maxLambdas));

                        console.log(`[Sync Endpoint] Dispatching stitch render using site ${siteName} on region ${region} with ${framesPerLambda} frames per lambda (total frames: ${totalFrames})`);

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
                            forceDurationInFrames: totalFrames, // Override duration dynamically
                            webhook: {
                                url: callbackUrl,
                                secret: null,
                                customData: {
                                    assetId: task.asset_id,
                                    isStitch: true
                                }
                            }
                        });

                        console.log(`[Sync Endpoint] Stitch render successfully delegated to AWS Lambda:`, renderResult.renderId);
                        
                        // Mark asset status as Rendering
                        if (task.asset_id) {
                            await supabaseAdmin.from('assets').update({ status: 'Rendering' }).eq('id', task.asset_id);
                        }

                        syncedResults.push({ taskId, assetId: task.asset_id, status: 'rendering_stitch' });
                        continue;

                    } catch (stitchErr: any) {
                        console.error("[Sync Endpoint] Lambda stitching dispatch failed:", stitchErr);
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
                    console.error(`[Sync Endpoint] Task ${taskId} failed on Kie.ai: ${failReason}`);

                    // A. Mark asset as 'Failed'
                    if (task.asset_id) {
                        await supabaseAdmin
                            .from('assets')
                            .update({ 
                                status: 'Failed',
                                metadata: { error: failReason }
                            })
                            .eq('id', task.asset_id);
                    }

                    // B. Delete all sibling video tasks sharing this asset_id
                    await supabaseAdmin.from('video_tasks').delete().eq('asset_id', task.asset_id);

                    syncedResults.push({ taskId, assetId: task.asset_id, status: 'failed', error: failReason });
                } else {
                    console.log(`[Sync Endpoint] Task ${taskId} is still in progress (Kie Status: ${status}).`);
                    syncedResults.push({ taskId, assetId: task.asset_id, status: 'processing' });
                }

            } catch (taskErr: any) {
                console.error(`[Sync Endpoint] Error synchronizing task ${taskId}:`, taskErr.message);
            }
        }

        return NextResponse.json({ success: true, synced: syncedResults });

    } catch (error: any) {
        console.error("[Sync Endpoint] Fatal error during synchronization:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
