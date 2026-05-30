import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extendVeoTask, createVeoTask, callGemini, createKieTask } from '@/utils/external-apis';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { sendPushNotification } from '@/utils/notification-helper';
import { exec } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

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
                const avatarUrl = videoTask.last_successful_task_id;
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
                    model: "bytedance/seedance-2-fast",
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
                    const referenceVideoUrls = [avatarUrl];
                    retryPayload.input.reference_video_urls = referenceVideoUrls;
                    console.log(`[Video Callback Retry] Passing character video reference: ${avatarUrl}`);
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
                await supabaseAdmin.from('assets').update({ 
                    status: 'Failed',
                    metadata: { error: msg || "AI video generation failed after maximum retries." }
                }).eq('id', videoTask.asset_id);
                // Clean up all video tasks sharing this asset_id
                await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);
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
            
            sceneR2Url = `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`;
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

        const stitcherWorkerUrl = process.env.STITCHER_WORKER_URL;
        if (stitcherWorkerUrl) {
            console.log(`[Video Callback] Offloading stitching to Cloud Run worker at ${stitcherWorkerUrl}...`);
            try {
                // Fire-and-forget: do not block Edge execution, return immediately to prevent callback timeouts.
                fetch(`${stitcherWorkerUrl.replace(/\/$/, '')}/stitch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        siblings: siblings.map(s => ({
                            current_index: s.current_index,
                            last_successful_task_id: s.last_successful_task_id
                        })),
                        videoTask: {
                            asset_id: videoTask.asset_id,
                            user_id: videoTask.user_id
                        }
                    })
                }).catch(e => console.error("[Video Callback] Cloud Run background trigger failed:", e));

                return NextResponse.json({ 
                    success: true, 
                    message: `All ${siblings.length} scenes completed. Offloaded stitching to Cloud Run.` 
                });
            } catch (err: any) {
                console.error("[Video Callback] Cloud Run worker dispatch failed, falling back to local:", err);
            }
        }

        console.log(`[Video Callback] All ${siblings.length} scenes completed. Initiating local stitching...`);

        const tempDir = path.join(os.tmpdir(), `stitch_${videoTask.asset_id}`);
        try {
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const localFiles: string[] = [];
            for (let idx = 0; idx < siblings.length; idx++) {
                const sib = siblings[idx];
                const clipUrl = sib.last_successful_task_id;
                if (!clipUrl || !clipUrl.startsWith('http')) {
                    throw new Error(`Invalid or missing video URL for scene index ${idx}`);
                }
                const localPath = path.join(tempDir, `scene_${idx}.mp4`);
                const res = await fetch(clipUrl);
                if (!res.ok) {
                    throw new Error(`Failed to download scene ${idx} from ${clipUrl}`);
                }
                const buffer = Buffer.from(await res.arrayBuffer());
                fs.writeFileSync(localPath, buffer);
                localFiles.push(localPath);
                console.log(`[Video Callback] Downloaded scene ${idx} to ${localPath}`);
            }

            // Generate concat.txt for FFmpeg
            const concatContent = localFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
            const concatTxtPath = path.join(tempDir, 'concat.txt');
            fs.writeFileSync(concatTxtPath, concatContent);

            const outputPath = path.join(tempDir, 'stitched.mp4');
            const ffmpegBinary = path.join(
                process.cwd(), 
                'node_modules', 
                'ffmpeg-static', 
                os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
            );
            const cmd = `"${ffmpegBinary}" -nostdin -y -loglevel error -f concat -safe 0 -i "${concatTxtPath}" -c copy "${outputPath}"`;

            
            console.log(`[Video Callback] Running FFmpeg command: ${cmd}`);
            
            await new Promise<void>((resolvePromise, rejectPromise) => {
                exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (execErr, stdout, stderr) => {
                    if (execErr) {
                        console.error(`[Video Callback] FFmpeg error:`, execErr);
                        console.error(`[Video Callback] FFmpeg stderr:`, stderr);
                        rejectPromise(execErr);
                    } else {
                        console.log(`[Video Callback] FFmpeg stdout:`, stdout);
                        resolvePromise();
                    }
                });
            });

            // Upload final stitched file to R2
            const stitchedBuffer = fs.readFileSync(outputPath);
            const finalFileName = `generated/${videoTask.user_id}/stitched_${Date.now()}.mp4`;
            await r2.send(new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: finalFileName,
                Body: stitchedBuffer,
                ContentType: 'video/mp4'
            }));
            const persistedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${finalFileName}`;
            console.log(`[Video Callback] Stitched video uploaded to R2: ${persistedUrl}`);

            // Update placeholder asset in Supabase
            if (videoTask.asset_id) {
                await supabaseAdmin.from('assets').update({
                    url: persistedUrl,
                    status: 'Draft' // Turns spinning card into real asset
                }).eq('id', videoTask.asset_id);
            }

            // Clean up database video_tasks records
            await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);

            // Send dynamic push notification
            const totalDuration = siblings.length * 15;
            await sendPushNotification(
                videoTask.user_id, 
                `🎬 ${totalDuration}s Video Creative Ready!`, 
                `Your ${totalDuration}-second stitched AI video ad has been generated successfully.`, 
                "/dashboard/assets", 
                "asset_ready"
            );
        } catch (stitchErr: any) {
            console.error("[Video Callback] Stitching or finalizing failed:", stitchErr);
            // Mark the asset as Failed
            if (videoTask.asset_id) {
                await supabaseAdmin.from('assets').update({ status: 'Failed' }).eq('id', videoTask.asset_id);
                await supabaseAdmin.from('video_tasks').delete().eq('asset_id', videoTask.asset_id);
            }
            return NextResponse.json({ error: stitchErr.message || 'Stitching failed' }, { status: 500 });
        } finally {
            // Clean up local temp files
            try {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    console.log(`[Video Callback] Cleaned up temporary directory: ${tempDir}`);
                }
            } catch (cleanupErr) {
                console.error(`[Video Callback] Error cleaning up temporary directory:`, cleanupErr);
            }
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Video Callback Fatal Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
