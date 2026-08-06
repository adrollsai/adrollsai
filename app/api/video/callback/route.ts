import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { renderMediaOnLambda } from '@remotion/lambda';
import { speculateFunctionName } from '@remotion/lambda-client';
import { extendVeoTask, createVeoTask, callGemini, createKieTask } from '@/utils/external-apis';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { sendPushNotification } from '@/utils/notification-helper';
import { exec } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { generateAndUploadVideoThumbnail } from '@/utils/video-thumbnail-helper';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Bulletproof helper to extract video URL from Kie.ai callback/recordInfo JSON response.
 * Safely handles format changes, fallbacks, and nested data structures.
 * Kie.ai sends `resultJson` as a STRINGIFIED JSON, not a nested object!
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

    // 3. Fallback to resultJson field (THIS IS THE KEY FIX - Kie sends resultJson as a string!)
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
            console.error("[Video Callback] Error parsing resultJson:", e);
        }
    }

    // 4. Recursive search fallback: Find the first substring that looks like a video URL
    try {
        const jsonStr = JSON.stringify(checkData);
        const matches = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|mov|avi|webm)[^"]*)"/i);
        if (matches && matches.length > 1) {
            console.log(`[Video Callback] Regex-matched video URL: ${matches[1]}`);
            return matches[1];
        }
    } catch (e) {
        console.error("[Video Callback] Regex URL extraction error:", e);
    }

    return null;
}

export async function POST(request: Request) {
    console.log(`[Video Callback] Incoming Request: ${request.method} ${request.url}`);
    
    // Handle OPTIONS (Preflight)
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 200 });
    }

    try {
        const text = await request.text();
        console.log(`[Video Callback] Raw Body Length: ${text.length}`);
        
        if (!text) {
            console.warn("[Video Callback] Received empty body. This might be a ping from Kie.ai.");
            return NextResponse.json({ message: "Empty body received" }, { status: 200 });
        }

        let body;
        try {
            body = JSON.parse(text);
        } catch (e) {
            console.error("[Video Callback] JSON Parse Error. Raw body sample:", text.substring(0, 200));
            return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const { code, msg, data } = body;
        const taskId = data?.taskId;

        console.log(`[Video Callback] Incoming payload for taskId: ${taskId}`);
        console.log(`[Video Callback] Info:`, JSON.stringify(data?.info, null, 2));

        if (!taskId) {
            console.error("[Video Callback] Missing taskId in payload");
            return NextResponse.json({ error: 'Missing taskId in callback' }, { status: 400 });
        }

        console.log(`[Video Callback] Received callback for task: ${taskId}, Code: ${code}`);

        // 1. Find the video task state
        const { data: videoTask, error: fetchError } = await supabaseAdmin
            .from('video_tasks')
            .select('*')
            .eq('last_task_id', taskId)
            .single();

        if (fetchError || !videoTask) {
            console.error("[Video Callback] Task not found in DB:", taskId);
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        // 2. Handle failure (Retry Logic)
        if (code !== 200 && code !== 0) {
            console.error(`[Video Callback] Kie.ai Task Failed: ${msg}`);
            
            const retryCount = videoTask.retry_count || 0;
            const maxRetries = 3;

            if (retryCount < maxRetries) {
                console.log(`[Video Callback] Clip failed. Waiting 10 seconds before attempting retry ${retryCount + 1}/${maxRetries} for task ${videoTask.id}...`);
                
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                let currentPrompt = videoTask.prompts[videoTask.current_index];
                const isPolicyViolation = /policy|allowed|sensitive|restricted|violation/i.test(msg || "");

                if (isPolicyViolation) {
                    console.log(`[Video Callback] Policy violation detected. Rewriting prompt with AI...`);
                    try {
                        const rewrittenPrompt = await callGemini(`The following video generation prompt was flagged for a policy violation: "${currentPrompt}". Please rewrite it to be safe, professional, and compliant with AI safety guidelines while maintaining the original creative intent for a real estate marketing video. Avoid any sensitive, restricted, or potentially harmful content. Return ONLY the rewritten prompt text.`);
                        if (rewrittenPrompt) {
                            console.log(`[Video Callback] Original: ${currentPrompt}`);
                            console.log(`[Video Callback] Rewritten: ${rewrittenPrompt}`);
                            currentPrompt = rewrittenPrompt;
                            
                            // Update the prompt in the database so we use the safe version from now on
                            const updatedPrompts = [...videoTask.prompts];
                            updatedPrompts[videoTask.current_index] = rewrittenPrompt;
                            await supabaseAdmin.from('video_tasks').update({ prompts: updatedPrompts }).eq('id', videoTask.id);
                        }
                    } catch (aiErr) {
                        console.error("[Video Callback] AI Rewrite Failed, retrying with original prompt anyway.", aiErr);
                    }
                }

                // Prepare Retry Payload (Seedance 2.0 Fast)
                let nextTaskId = null;
                let error = null;

                // Detect Base URL for Callback
                const forwardedHost = request.headers.get('x-forwarded-host');
                const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
                const requestOrigin = new URL(request.url).origin;
                const publicUrl = process.env.NEXT_PUBLIC_APP_URL;
                let baseUrl = requestOrigin;
                if (forwardedHost && !forwardedHost.includes('localhost')) baseUrl = `${forwardedProto}://${forwardedHost}`;
                else if (!requestOrigin.includes('localhost')) baseUrl = requestOrigin;
                else if (publicUrl && publicUrl.startsWith('http') && !publicUrl.includes('localhost')) baseUrl = publicUrl;
                const callbackUrl = `${baseUrl}/api/video/callback`;

                let refImages: string[] = [];
                let avatarUrl = videoTask.last_successful_task_id;
                const isCharacterVideo = avatarUrl && (/\.(mp4|webm|mov|avi|wmv)/i.test(avatarUrl) || avatarUrl.includes('video'));
                
                if (avatarUrl && avatarUrl.startsWith('http') && !isCharacterVideo) {
                    refImages.push(avatarUrl);
                }

                if (videoTask.property_id) {
                    const { data: prop } = await supabaseAdmin
                        .from('properties')
                        .select('images, image_url')
                        .eq('id', videoTask.property_id)
                        .single();
                    if (prop) {
                        const propImages = prop.images || (prop.image_url ? [prop.image_url] : []);
                        refImages = [...refImages, ...propImages];
                    }
                }

                const retryPayload: any = {
                    model: "bytedance/seedance-2-mini",
                    callBackUrl: callbackUrl,
                    input: {
                        prompt: currentPrompt,
                        aspect_ratio: "9:16",
                        duration: 15,
                        generate_audio: true,
                        resolution: "480p",
                        nsfw_checker: true,
                        web_search: false
                    }
                };

                if (refImages.length > 0) {
                    retryPayload.input.reference_image_urls = refImages.slice(0, 9);
                }

                if (avatarUrl && isCharacterVideo) {
                    let referenceVideoUrls = [avatarUrl];
                    retryPayload.input.reference_video_urls = referenceVideoUrls;
                    console.log(`[Video Callback Retry] Passing character video reference: ${avatarUrl}`);

                    let referenceAudioUrl = "";
                    try {
                        const selectRes = await supabaseAdmin
                            .from('profiles')
                            .select('character_audio_url, avatar_audio_url')
                            .eq('id', videoTask.user_id)
                            .single();
                        
                        let userProfile: any = selectRes.data;
                        if (selectRes.error) {
                            console.warn(`[Video Callback Retry] Failed to select with avatar_audio_url, retrying without it:`, selectRes.error.message);
                            const fallbackRes = await supabaseAdmin
                                .from('profiles')
                                .select('character_audio_url')
                                .eq('id', videoTask.user_id)
                                .single();
                            userProfile = fallbackRes.data;
                        }

                        if (isCharacterVideo && userProfile?.character_audio_url) {
                            referenceAudioUrl = userProfile.character_audio_url;
                            console.log(`[Video Callback Retry] Found video character voice sample in user profile: ${referenceAudioUrl}`);
                        } else if (!isCharacterVideo && userProfile?.avatar_audio_url) {
                            referenceAudioUrl = userProfile.avatar_audio_url;
                            console.log(`[Video Callback Retry] Found avatar character voice sample in user profile: ${referenceAudioUrl}`);
                        }
                    } catch (dbErr) {
                        console.error(`[Video Callback Retry] Failed to query user voice sample from profile:`, dbErr);
                    }
                    
                    if (referenceAudioUrl) {
                        retryPayload.input.reference_audio_urls = [referenceAudioUrl];
                        console.log(`[Video Callback Retry] Passing character audio reference: ${referenceAudioUrl}`);
                    } else if (isCharacterVideo) {
                        console.error(`[Video Callback Retry] ERROR: No valid reference audio available for retry. Voice cloning cannot proceed.`);
                        throw new Error("Cannot retry video task without a valid voice sample in profile settings.");
                    }
                }

                const { taskId: retryTaskId, error: retryError } = await createKieTask(retryPayload);
                nextTaskId = retryTaskId;
                error = retryError;

                if (nextTaskId) {
                    await supabaseAdmin.from('video_tasks').update({
                        last_task_id: nextTaskId,
                        retry_count: retryCount + 1,
                        last_error: msg
                    }).eq('id', videoTask.id);
                    return NextResponse.json({ success: true, message: "Retry triggered" });
                } else {
                    console.error("[Video Callback] Retry trigger failed:", error);
                }
            }

            // If we reach here, all retries failed or max retries reached
            await supabaseAdmin.from('video_tasks').update({ status: 'Failed', last_error: msg }).eq('id', videoTask.id);
            if (videoTask.asset_id) {
                // Find sibling tasks sharing this asset_id to know the number of clips generated
                const { data: siblingTasks } = await supabaseAdmin
                    .from('video_tasks')
                    .select('id')
                    .eq('asset_id', videoTask.asset_id);
                const taskCount = siblingTasks?.length || 1;

                await supabaseAdmin.from('assets').update({ 
                    status: 'Failed',
                    metadata: { error: msg || "AI video generation failed after maximum retries." }
                }).eq('id', videoTask.asset_id);
                
                // Clean up all video tasks sharing this asset_id
                await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);

                // Refund the videos quota limit
                try {
                    const { refundLimit } = await import('@/utils/subscription-server');
                    await refundLimit(videoTask.user_id, 'videos');
                } catch (limErr) {
                    console.error("Failed to refund limit in video callback:", limErr);
                }

                // Refund the credits
                try {
                    const { addCredits } = await import('@/utils/credits');
                    const refundAmount = taskCount * 250;
                    await addCredits(supabaseAdmin, videoTask.user_id, refundAmount, 'ai_generation', `Refund: AI Video Generation failed after maximum retries (${taskCount} clips)`);
                } catch (crErr) {
                    console.error("Failed to refund credits in video callback:", crErr);
                }
            }
            return NextResponse.json({ success: true });
        }

        // Robust result URL extraction for Kie.ai callbacks (Seedance 2.0 Fast etc.)
        // Kie.ai sends `resultJson` as a STRINGIFIED JSON, not a nested object!
        const resultUrl = extractVideoUrl(data);

        console.log(`[Video Callback] Extracted result URL: ${resultUrl}`);

        if (!resultUrl || typeof resultUrl !== 'string' || !resultUrl.startsWith('http')) {
            console.error("[Video Callback] Could not extract a valid result video URL from Kie callback data:", JSON.stringify(data, null, 2));
            return NextResponse.json({ error: "Invalid result URL in callback payload" }, { status: 400 });
        }



        // Persist the individual completed scene to R2
        let sceneR2Url = resultUrl;
        try {
            const videoRes = await fetch(resultUrl);
            const buffer = Buffer.from(await videoRes.arrayBuffer());
            const fileName = `generated/${videoTask.user_id}/scene_${videoTask.current_index}_${Date.now()}.mp4`;
            
            await r2.send(new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: fileName,
                Body: buffer,
                ContentType: 'video/mp4'
            }));
            
            sceneR2Url = `${R2_PUBLIC_URL}/${fileName}`;
            console.log(`[Video Callback] Scene ${videoTask.current_index + 1} persisted to R2: ${sceneR2Url}`);
        } catch (r2Error) {
            console.error("[Video Callback] R2 Scene Persistence Failed:", r2Error);
        }

        // Update this task record in video_tasks to Completed
        await supabaseAdmin
            .from('video_tasks')
            .update({
                status: 'Completed',
                last_successful_task_id: sceneR2Url
            })
            .eq('id', videoTask.id);

        // Check if all sibling tasks sharing the same asset_id are complete
        const { data: siblings, error: siblingsError } = await supabaseAdmin
            .from('video_tasks')
            .select('*')
            .eq('asset_id', videoTask.asset_id);

        if (siblingsError) {
            console.error("[Video Callback] Error fetching sibling tasks:", siblingsError);
            return NextResponse.json({ error: 'Failed to fetch sibling tasks' }, { status: 500 });
        }

        const allCompleted = siblings && siblings.length > 0 && siblings.every(s => s.status === 'Completed');

        if (!allCompleted) {
            console.log(`[Video Callback] Scene ${videoTask.current_index + 1} completed. Waiting for other scene(s) to complete...`);
            return NextResponse.json({ success: true, message: `Scene ${videoTask.current_index + 1} completed. Waiting for other clips.` });
        }

        // All scenes are completed! Stitch them together
        siblings.sort((a, b) => a.current_index - b.current_index);

        // If there is only 1 scene AND no voiceover audio attached, bypass the stitcher and finalize immediately
        if (siblings.length === 1 && !videoTask.audio_url) {
            const clipUrl = siblings[0].last_successful_task_id;
            console.log(`[Video Callback] Single-clip video detected (15s). Finalizing asset and applying faststart: ${clipUrl}`);
            
            let finalUrl = clipUrl;
            let thumbnailUrl = null;
            
            // Run faststart pass to fix WhatsApp thumbnail issue
            const tempDir = path.join(os.tmpdir(), `faststart_${videoTask.asset_id}`);
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
                console.log(`[Video Callback] Running FFmpeg faststart command: ${cmd}`);
                
                await new Promise<void>((resolvePromise, rejectPromise) => {
                    exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr, stdout, stderr) => {
                        if (execErr) {
                            rejectPromise(execErr);
                        } else {
                            resolvePromise();
                        }
                    });
                });
                
                // Upload faststart file to R2
                const faststartBuffer = fs.readFileSync(outputPath);
                const finalFileName = `generated/${videoTask.user_id}/faststart_${Date.now()}.mp4`;
                await r2.send(new PutObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: finalFileName,
                    Body: faststartBuffer,
                    ContentType: 'video/mp4'
                }));
                finalUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
                console.log(`[Video Callback] Faststart single video uploaded to R2: ${finalUrl}`);

                // Generate video thumbnail
                try {
                    thumbnailUrl = await generateAndUploadVideoThumbnail(outputPath, videoTask.user_id, videoTask.asset_id);
                } catch (thumbErr) {
                    console.error("[Video Callback] Thumbnail generation failed:", thumbErr);
                }
            } catch (faststartErr) {
                console.error("[Video Callback] Faststart process failed, falling back to original clip URL:", faststartErr);
            } finally {
                try {
                    if (fs.existsSync(tempDir)) {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    }
                } catch (cleanupErr) {
                    console.error("[Video Callback] Faststart cleanup failed:", cleanupErr);
                }
            }
            
            if (videoTask.asset_id) {
                await supabaseAdmin.from('assets').update({
                    url: finalUrl,
                    status: 'Draft',
                    metadata: thumbnailUrl ? { thumbnailUrl } : {}
                }).eq('id', videoTask.asset_id);
            }
            
            // Clean up DB tasks
            await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);
            
            // Send push notification
            await sendPushNotification(
                videoTask.user_id, 
                `🎬 15s Video Creative Ready!`, 
                `Your 15-second AI video ad has been generated successfully.`, 
                "/dashboard/assets", 
                "asset_ready"
            );
            
            return NextResponse.json({ success: true, message: "Single scene video finalized successfully." });
        }

        // Retrieve AWS configurations and dispatch stitching to AWS Lambda
        try {
            console.log(`[Video Callback] Offloading stitching for Asset ID ${videoTask.asset_id} to AWS Lambda StitchComposition...`);
            
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
            console.log(`[Video Callback] Using callback URL for stitching: ${callbackUrl}`);

            const functionName = speculateFunctionName({
                diskSizeInMb: 512,
                memorySizeInMb: 2048,
                timeoutInSeconds: 900,
            });

            const bucketName = process.env.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
            const siteName = process.env.REMOTION_AWS_SITE_NAME || 'nobogent-site';
            const region = (process.env.REMOTION_AWS_REGION || 'us-east-1') as any;

            // Use 250+ frames per Lambda (max 3 Lambdas total) to prevent Chromium remote video seeking stalls at chunk boundaries
            const clipDurationSec = 15;
            const totalFrames = siblings.length * clipDurationSec * 30;
            const maxLambdas = 3;
            const framesPerLambda = Math.max(250, Math.ceil(totalFrames / maxLambdas));

            console.log(`[Video Callback] Dispatching stitch render using site ${siteName} on region ${region} with ${framesPerLambda} frames per lambda (total frames: ${totalFrames})`);

            // Probe actual clip durations to avoid freeze at end of short Grok clips
            let clipDurationsInSeconds: number[] | undefined = undefined;
            const isGrokModel = !!videoTask.audio_url || videoTask.prompts?.[0]?.toLowerCase().includes('grok') || videoTask.prompts?.[0]?.toLowerCase().includes('identity lock');
            if (isGrokModel) {
                try {
                    const ffmpegBinary = path.join(
                        process.cwd(),
                        'node_modules',
                        'ffmpeg-static',
                        os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
                    );
                    const ffprobeBinary = ffmpegBinary.replace(/ffmpeg(\.exe)?$/, (_, ext) => `ffprobe${ext || ''}`);
                    const ffprobeExec = fs.existsSync(ffprobeBinary) ? ffprobeBinary : 'ffprobe';

                    clipDurationsInSeconds = await Promise.all(
                        siblings.map(async (s) => {
                            try {
                                const probeResult = await new Promise<string>((res, rej) => {
                                    exec(
                                        `"${ffprobeExec}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${s.last_successful_task_id}"`,
                                        (err, stdout) => { if (err) rej(err); else res(stdout.trim()); }
                                    );
                                });
                                const dur = parseFloat(probeResult);
                                if (!isNaN(dur) && dur > 0) {
                                    console.log(`[Video Callback] Probed clip duration: ${dur}s for ${s.last_successful_task_id}`);
                                    return dur;
                                }
                            } catch (probeErr) {
                                console.warn(`[Video Callback] ffprobe failed for clip, defaulting to 15s:`, probeErr);
                            }
                            return 15; // Grok clips are 15s when duration:15 is passed
                        })
                    );
                    console.log(`[Video Callback] Per-clip durations: ${clipDurationsInSeconds.join(', ')}s`);
                } catch (probeErr) {
                    console.warn('[Video Callback] Duration probing failed, using 15s fallback for all Grok clips:', probeErr);
                    clipDurationsInSeconds = siblings.map(() => 15);
                }
            }

            // Calculate actual total frames from real clip durations
            const realClipDurations = clipDurationsInSeconds ?? siblings.map(() => clipDurationSec);
            const actualTotalFrames = Math.round(realClipDurations.reduce((sum, d) => sum + d, 0) * 30);
            const framesPerLambdaActual = Math.max(250, Math.ceil(actualTotalFrames / maxLambdas));

            console.log(`[Video Callback] Dispatching stitch render using site ${siteName} on region ${region} with ${framesPerLambdaActual} frames per lambda (actual total frames: ${actualTotalFrames})`);

            // Resolve TTS voiceover audio for Grok if a task ID or URL was attached
            let finalAudioUrl = videoTask.audio_url || null;
            if (!finalAudioUrl && videoTask.asset_id) {
                const { data: assetRow } = await supabaseAdmin.from('assets').select('metadata').eq('id', videoTask.asset_id).single();
                if (assetRow?.metadata?.audioUrl) {
                    finalAudioUrl = assetRow.metadata.audioUrl;
                    console.log(`[Video Callback] Resolved audioUrl from asset metadata fallback: ${finalAudioUrl}`);
                }
            }
            if (finalAudioUrl && finalAudioUrl.startsWith('tts:')) {
                const ttsTaskId = finalAudioUrl.replace(/^tts:/, '');
                try {
                    console.log(`[Video Callback] Polling asynchronous Gemini TTS task ${ttsTaskId}...`);
                    const { queryKieTask } = await import('@/utils/external-apis');
                    for (let t = 0; t < 20; t++) {
                        const ttsStatus = await queryKieTask(ttsTaskId);
                        if (ttsStatus.state === 'success' && ttsStatus.resultUrl) {
                            try {
                                const audioRes = await fetch(ttsStatus.resultUrl);
                                if (audioRes.ok) {
                                    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
                                    const r2Key = `voiceover/${Date.now()}_grok_async_tts.mp3`;
                                    await r2.send(new PutObjectCommand({
                                        Bucket: R2_BUCKET,
                                        Key: r2Key,
                                        Body: audioBuffer,
                                        ContentType: 'audio/mpeg'
                                    }));
                                    finalAudioUrl = `${R2_PUBLIC_URL}/${r2Key.replace(/^\//, '')}`;
                                    console.log(`[Video Callback] Async Gemini TTS voiceover resolved and persisted to R2: ${finalAudioUrl}`);
                                } else {
                                    finalAudioUrl = ttsStatus.resultUrl;
                                }
                            } catch (r2Err) {
                                finalAudioUrl = ttsStatus.resultUrl;
                            }
                            break;
                        }
                        if (ttsStatus.state === 'fail') {
                            console.warn(`[Video Callback] Gemini TTS task ${ttsTaskId} failed.`);
                            finalAudioUrl = null;
                            break;
                        }
                        await new Promise(r => setTimeout(r, 2000));
                    }
                } catch (ttsErr: any) {
                    console.warn(`[Video Callback] Async Gemini TTS resolution error:`, ttsErr.message);
                }
            }

            if (isGrokModel && (!finalAudioUrl || finalAudioUrl.startsWith('tts:'))) {
                try {
                    const { data: assetRecord } = await supabaseAdmin
                        .from('assets')
                        .select('caption, metadata')
                        .eq('id', videoTask.asset_id)
                        .single();

                    if (assetRecord?.metadata?.audioUrl) {
                        let candidateUrl = assetRecord.metadata.audioUrl;
                        if (candidateUrl.startsWith('tts:')) {
                            const ttsTaskId = candidateUrl.replace(/^tts:/, '');
                            console.log(`[Video Callback] Resolving Gemini TTS task ${ttsTaskId} from asset metadata...`);
                            const { queryKieTask } = await import('@/utils/external-apis');
                            for (let t = 0; t < 15; t++) {
                                const ttsStatus = await queryKieTask(ttsTaskId);
                                if (ttsStatus.state === 'success' && ttsStatus.resultUrl) {
                                    candidateUrl = ttsStatus.resultUrl;
                                    break;
                                }
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                        if (candidateUrl && (candidateUrl.startsWith('http://') || candidateUrl.startsWith('https://'))) {
                            finalAudioUrl = candidateUrl;
                        }
                    }

                    if (!finalAudioUrl || finalAudioUrl.startsWith('tts:')) {
                        const voiceoverText = assetRecord?.caption || '';
                        if (voiceoverText && voiceoverText.length > 10) {
                            console.log(`[Video Callback] Generating fallback Grok voiceover for asset ${videoTask.asset_id}...`);
                            const { createGeminiTTS, queryKieTask } = await import('@/utils/external-apis');
                            const { taskId: ttsTaskId, error: ttsError } = await createGeminiTTS({
                                dialogueText: voiceoverText,
                                speakerName: 'Aoede',
                                style: '',
                                scene: 'Professional real estate commercial voiceover studio',
                                sampleContext: 'High converting luxury real estate marketing video'
                            });

                            if (ttsTaskId && !ttsError) {
                                for (let t = 0; t < 12; t++) {
                                    await new Promise(r => setTimeout(r, 2500));
                                    const ttsStatus = await queryKieTask(ttsTaskId);
                                    if (ttsStatus.state === 'success' && ttsStatus.resultUrl) {
                                        try {
                                            const audioRes = await fetch(ttsStatus.resultUrl);
                                            if (audioRes.ok) {
                                                const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
                                                const r2Key = `voiceover/${Date.now()}_grok_stitch.mp3`;
                                                await r2.send(new PutObjectCommand({
                                                    Bucket: R2_BUCKET,
                                                    Key: r2Key,
                                                    Body: audioBuffer,
                                                    ContentType: 'audio/mpeg'
                                                }));
                                                finalAudioUrl = `${R2_PUBLIC_URL}/${r2Key.replace(/^\//, '')}`;
                                                console.log(`[Video Callback] Grok voiceover generated and persisted: ${finalAudioUrl}`);
                                            }
                                        } catch (r2VoiceErr) {
                                            finalAudioUrl = ttsStatus.resultUrl;
                                        }
                                        break;
                                    }
                                    if (ttsStatus.state === 'fail') break;
                                }
                            }
                        }
                    }
                } catch (ttsErr) {
                    console.warn('[Video Callback] Inline TTS generation failed, continuing without voiceover:', ttsErr);
                }
            }

            // --- HIGH-SPEED DIRECT FFMPEG STITCHING ENGINE ---
            // Bypasses AWS Lambda concurrency limits & rate exceeded errors for instant, zero-cost 2-second video stitching
            try {
                console.log(`[Video Callback] Starting fast local FFmpeg stitching for Asset ID ${videoTask.asset_id}...`);
                const tempStitchDir = path.join(os.tmpdir(), `stitch_cb_${videoTask.asset_id}_${Date.now()}`);
                if (!fs.existsSync(tempStitchDir)) {
                    fs.mkdirSync(tempStitchDir, { recursive: true });
                }

                const localClipPaths: string[] = [];
                for (let idx = 0; idx < siblings.length; idx++) {
                    const s = siblings[idx];
                    const clipPath = path.join(tempStitchDir, `scene_${idx}.mp4`);
                    console.log(`[Video Callback] Downloading scene ${idx + 1}/${siblings.length}: ${s.last_successful_task_id}`);
                    const clipRes = await fetch(s.last_successful_task_id);
                    if (!clipRes.ok) throw new Error(`Failed to download scene ${idx + 1} for FFmpeg stitching`);
                    fs.writeFileSync(clipPath, Buffer.from(await clipRes.arrayBuffer()));
                    localClipPaths.push(clipPath);
                }

                const concatTxtContent = localClipPaths.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
                const concatTxtPath = path.join(tempStitchDir, 'concat.txt');
                fs.writeFileSync(concatTxtPath, concatTxtContent);

                let localAudioPath: string | null = null;
                if (finalAudioUrl && (finalAudioUrl.startsWith('http://') || finalAudioUrl.startsWith('https://'))) {
                    try {
                        console.log(`[Video Callback] Downloading voiceover audio for fast FFmpeg stitch: ${finalAudioUrl}`);
                        const audioRes = await fetch(finalAudioUrl);
                        if (audioRes.ok) {
                            localAudioPath = path.join(tempStitchDir, 'voiceover.mp3');
                            fs.writeFileSync(localAudioPath, Buffer.from(await audioRes.arrayBuffer()));
                        }
                    } catch (audErr) {
                        console.warn(`[Video Callback] Failed to download voiceover audio for fast FFmpeg stitch:`, audErr);
                    }
                }

                const ffmpegBinary = path.join(
                    process.cwd(),
                    'node_modules',
                    'ffmpeg-static',
                    os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
                );
                const ffmpegExec = fs.existsSync(ffmpegBinary) ? ffmpegBinary : 'ffmpeg';

                const outputPath = path.join(tempStitchDir, 'final_stitched.mp4');
                const ffmpegCmd = localAudioPath
                    ? `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -i "${localAudioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -ar 48000 -ac 2 -movflags +faststart "${outputPath}"`
                    : `"${ffmpegExec}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -c copy -movflags +faststart "${outputPath}"`;

                console.log(`[Video Callback] Executing fast FFmpeg command: ${ffmpegCmd}`);
                await new Promise<void>((resolve, reject) => {
                    exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr, stdout, stderr) => {
                        if (execErr) reject(execErr);
                        else resolve();
                    });
                });

                const stitchedBuffer = fs.readFileSync(outputPath);
                const r2Key = `generated/${videoTask.user_id}/stitched_${Date.now()}.mp4`;
                await r2.send(new PutObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: r2Key,
                    Body: stitchedBuffer,
                    ContentType: 'video/mp4'
                }));

                const finalR2Url = `${R2_PUBLIC_URL}/${r2Key}`;
                console.log(`[Video Callback] Fast FFmpeg stitch completed & uploaded to R2: ${finalR2Url}`);

                let thumbnailUrl: string | null = null;
                try {
                    thumbnailUrl = await generateAndUploadVideoThumbnail(outputPath, videoTask.user_id, videoTask.asset_id);
                } catch (thumbErr) {
                    console.error("[Video Callback] Fast stitch thumbnail generation error:", thumbErr);
                }

                try { fs.rmSync(tempStitchDir, { recursive: true, force: true }); } catch (e) {}

                if (videoTask.asset_id) {
                    await supabaseAdmin.from('assets').update({
                        url: finalR2Url,
                        status: 'Draft',
                        metadata: {
                            ...(thumbnailUrl ? { thumbnailUrl } : {}),
                            ...(finalAudioUrl ? { audioUrl: finalAudioUrl } : {})
                        }
                    }).eq('id', videoTask.asset_id);
                }

                await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);

                await sendPushNotification(
                    videoTask.user_id,
                    `🎬 Grok Video Creative Ready!`,
                    `Your multi-scene AI video ad has been generated & stitched successfully.`,
                    "/dashboard/assets",
                    "asset_ready"
                );

                return NextResponse.json({
                    success: true,
                    message: `All ${siblings.length} scenes stitched with fast FFmpeg successfully.`
                });

            } catch (fastFfmpegErr: any) {
                console.warn(`[Video Callback] Fast local FFmpeg stitching failed, falling back to AWS Lambda:`, fastFfmpegErr?.message || fastFfmpegErr);
            }

            // --- FALLBACK TO AWS LAMBDA (IF LOCAL FFMPEG FAILS) ---
            const inputPropsPayload: any = {
                videoUrls: siblings.map(s => s.last_successful_task_id),
                clipDurationInSeconds: realClipDurations[0] ?? 8,
                ...(clipDurationsInSeconds ? { clipDurationsInSeconds } : {})
            };

            if (finalAudioUrl && (finalAudioUrl.startsWith('http://') || finalAudioUrl.startsWith('https://'))) {
                inputPropsPayload.audioUrl = finalAudioUrl;
                console.log(`[Video Callback] Including verified HTTP voiceover audio in stitch render: ${finalAudioUrl}`);
            } else {
                console.warn(`[Video Callback] Warning: No valid HTTP voiceover audio URL resolved. Dispatched stitch render without audio.`);
            }

            const renderResult = await renderMediaOnLambda({
                region,
                functionName,
                serveUrl: `https://${bucketName}.s3.${region}.amazonaws.com/sites/${siteName}/index.html`,
                composition: 'StitchComposition',
                inputProps: inputPropsPayload,
                codec: 'h264',
                imageFormat: 'jpeg',
                maxRetries: 2,
                privacy: 'public',
                framesPerLambda: framesPerLambdaActual,
                forceDurationInFrames: actualTotalFrames,
                webhook: {
                    url: callbackUrl,
                    secret: null,
                    customData: {
                        assetId: videoTask.asset_id,
                        isStitch: true
                    }
                }
            });

            console.log(`[Video Callback] Stitch render successfully dispatched to AWS Lambda:`, renderResult.renderId);
            
            if (videoTask.asset_id) {
                await supabaseAdmin.from('assets').update({ status: 'Rendering' }).eq('id', videoTask.asset_id);
            }

            return NextResponse.json({ 
                success: true, 
                message: `All ${siblings.length} scenes completed. Dispatched stitch rendering to AWS Lambda.` 
            });

        } catch (stitchErr: any) {
            console.error("[Video Callback] Lambda stitching dispatch failed:", stitchErr);
            if (videoTask.asset_id) {
                await supabaseAdmin.from('assets').update({ status: 'Failed' }).eq('id', videoTask.asset_id);
                await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);
                
                // Refund the videos limit
                try {
                    const { refundLimit } = await import('@/utils/subscription-server');
                    await refundLimit(videoTask.user_id, 'videos');
                } catch (limErr) {
                    console.error("Failed to refund limit in video callback:", limErr);
                }

                // Refund credits
                try {
                    const { addCredits } = await import('@/utils/credits');
                    const refundAmount = siblings.length * 250;
                    await addCredits(supabaseAdmin, videoTask.user_id, refundAmount, 'ai_generation', `Refund: Stitching dispatch failed (${siblings.length} clips)`);
                } catch (crErr) {
                    console.error("Failed to refund credits in video callback:", crErr);
                }
            }
            return NextResponse.json({ error: stitchErr.message || 'Stitching dispatch failed' }, { status: 500 });
        }

    } catch (error: any) {
        console.error("Video Callback Fatal Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
