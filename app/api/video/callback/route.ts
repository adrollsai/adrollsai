import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extendVeoTask, createVeoTask, callGemini } from '@/utils/external-apis';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { sendPushNotification } from '@/utils/notification-helper';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
                
                // Add a slightly longer delay to handle transient API issues
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

                // Prepare Retry Payload
                const isFirstScene = videoTask.current_index === 0;
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

                if (isFirstScene) {
                    // Retry Scene 1 (Initial Task)
                    const { taskId: retryTaskId, error: retryError } = await createVeoTask({
                        prompt: currentPrompt,
                        model: "veo3_lite",
                        resolution: "720p",
                        aspect_ratio: videoTask.aspect_ratio || "9:16",
                        callBackUrl: callbackUrl
                    });
                    nextTaskId = retryTaskId;
                    error = retryError;
                } else {
                    // Retry Scene 2-4 (Extension Task)
                    // We use the last successful task ID as the base for the extension
                    const baseTaskId = videoTask.last_successful_task_id || videoTask.last_task_id;
                    const { taskId: retryTaskId, error: retryError } = await extendVeoTask({
                        taskId: baseTaskId, 
                        prompt: currentPrompt,
                        model: "lite",
                        callBackUrl: callbackUrl
                    });
                    nextTaskId = retryTaskId;
                    error = retryError;
                }

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
                await supabaseAdmin.from('assets').update({ status: 'Failed' }).eq('id', videoTask.asset_id);
            }
            return NextResponse.json({ success: true });
        }

        const info = data?.info;
        const resultUrls = info?.fullResultUrls || info?.full_result_urls || info?.resultUrls || info?.result_urls;
        
        let resultUrl = Array.isArray(resultUrls) ? resultUrls[0] : resultUrls;

        if (Array.isArray(resultUrls) && resultUrls.length > 1) {
            console.log(`[Video Callback] Multiple URLs found in prioritized field. Detecting full stitched video...`);
            try {
                const sizes = await Promise.all(resultUrls.map(async (url) => {
                    const res = await fetch(url, { method: 'HEAD' });
                    return { url, size: parseInt(res.headers.get('content-length') || '0') };
                }));
                
                sizes.sort((a, b) => b.size - a.size);
                console.log(`[Video Callback] File sizes detected:`, sizes.map(s => `${s.size} bytes`).join(', '));
                resultUrl = sizes[0].url;
            } catch (e) {
                console.error("[Video Callback] Error checking file sizes, falling back to first URL:", e);
            }
        }

        const nextIndex = videoTask.current_index + 1;

        // 3. Extension Logic
        if (nextIndex < 4) {
            console.log(`[Video Callback] CLIP ${videoTask.current_index + 1} DONE. Extending to CLIP ${nextIndex + 1}...`);
            
            const nextPrompt = videoTask.prompts[nextIndex];
            // --- BASE URL DETECTION ---
            const forwardedHost = request.headers.get('x-forwarded-host');
            const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
            const requestOrigin = new URL(request.url).origin;
            const publicUrl = process.env.NEXT_PUBLIC_APP_URL;

            let baseUrl = requestOrigin;
            
            if (forwardedHost && !forwardedHost.includes('localhost')) {
                baseUrl = `${forwardedProto}://${forwardedHost}`;
            } else if (!requestOrigin.includes('localhost')) {
                baseUrl = requestOrigin;
            } else if (publicUrl && publicUrl.startsWith('http') && !publicUrl.includes('localhost')) {
                baseUrl = publicUrl;
            }
                
            const callbackUrl = `${baseUrl}/api/video/callback`;
            
            console.log(`[Video Callback] Source Origin: ${requestOrigin}, Selected Base: ${baseUrl}`);
            console.log(`[Video Callback] Using callback URL: ${callbackUrl}`);
            
            if (baseUrl.includes('localhost')) {
                console.warn("[Video Callback] WARNING: Using localhost for callback! Kie.ai will NOT be able to reach your server.");
            }

            const extendPayload = {
                taskId: taskId, 
                prompt: nextPrompt,
                model: "lite", 
                callBackUrl: callbackUrl
            };

            const { taskId: nextTaskId, error: extendError } = await extendVeoTask(extendPayload);

            if (extendError || !nextTaskId) {
                console.error("[Video Callback] Extension trigger failed:", extendError);
                await supabaseAdmin.from('video_tasks').update({ status: 'Failed' }).eq('id', videoTask.id);
                if (videoTask.asset_id) {
                    await supabaseAdmin.from('assets').update({ status: 'Failed' }).eq('id', videoTask.asset_id);
                }
            } else {
                await supabaseAdmin.from('video_tasks').update({
                    current_index: nextIndex,
                    last_task_id: nextTaskId,
                    last_successful_task_id: taskId
                }).eq('id', videoTask.id);
            }
        } else {
            // 4. Finalization
            console.log(`[Video Callback] All clips done for task ${videoTask.id}. Finalizing...`);

            if (!resultUrl) {
                console.error("[Video Callback] No final result URL provided.");
                return NextResponse.json({ error: 'Missing final URL' }, { status: 400 });
            }

            // Persist to R2
            let persistedUrl = resultUrl;
            try {
                const videoRes = await fetch(resultUrl);
                const buffer = Buffer.from(await videoRes.arrayBuffer());
                const fileName = `generated/${videoTask.user_id}/video_${Date.now()}.mp4`;
                
                await r2.send(new PutObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: fileName,
                    Body: buffer,
                    ContentType: 'video/mp4'
                }));
                
                persistedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`;
            } catch (r2Error) {
                console.error("[Video Callback] R2 Persistence Failed:", r2Error);
            }

            // Update the PLACEHOLDER asset instead of inserting a new one
            if (videoTask.asset_id) {
                await supabaseAdmin.from('assets').update({
                    url: persistedUrl,
                    status: 'Draft' // Turns spinning card into real asset
                }).eq('id', videoTask.asset_id);
            }

            // Clean up video_tasks
            await supabaseAdmin.from('video_tasks').delete().eq('id', videoTask.id);

            // Send Push Notification
            await sendPushNotification(
                videoTask.user_id, 
                "🎬 Video Creative Ready!", 
                "Your 30-second AI video has been generated successfully.", 
                "/dashboard/assets", 
                "asset_ready"
            );
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Video Callback Fatal Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
