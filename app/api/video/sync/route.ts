import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { sendPushNotification } from '@/utils/notification-helper';

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

        // 2. Fetch processing video tasks for the user
        const { data: activeTasks, error: fetchError } = await supabaseAdmin
            .from('video_tasks')
            .select('*')
            .eq('user_id', user.id)
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
                        const fileName = `generated/${task.user_id}/video_${Date.now()}.mp4`;
                        
                        await r2.send(new PutObjectCommand({
                            Bucket: R2_BUCKET,
                            Key: fileName,
                            Body: buffer,
                            ContentType: 'video/mp4'
                        }));
                        
                        persistedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`;
                        console.log(`[Sync Endpoint] Successfully uploaded video to R2: ${persistedUrl}`);
                    } catch (r2Error) {
                        console.error("[Sync Endpoint] R2 upload failed. Falling back to direct Kie URL.", r2Error);
                    }

                    // B. Update Asset in Supabase to 'Draft'
                    if (task.asset_id) {
                        const { error: assetError } = await supabaseAdmin
                            .from('assets')
                            .update({
                                url: persistedUrl,
                                status: 'Draft'
                            })
                            .eq('id', task.asset_id);

                        if (assetError) {
                            console.error(`[Sync Endpoint] Failed to update asset status for ID ${task.asset_id}:`, assetError);
                        } else {
                            console.log(`[Sync Endpoint] Asset ID ${task.asset_id} updated successfully.`);
                        }
                    }

                    // C. Delete the synchronized video task
                    await supabaseAdmin.from('video_tasks').delete().eq('id', task.id);

                    // D. Send Push Notification
                    await sendPushNotification(
                        task.user_id, 
                        "🎬 Video Creative Ready!", 
                        "Your 15-second AI video has been synchronized and is ready for use.", 
                        "/dashboard/assets", 
                        "asset_ready"
                    ).catch(notifErr => console.error("[Sync Endpoint] Notification error:", notifErr));

                    syncedResults.push({ taskId, assetId: task.asset_id, status: 'succeeded' });

                } else if (status === 'failed' || status === 'error') {
                    const failReason = checkData.failMsg || checkData.error || checkData.msg || "Unknown Kie.ai Error";
                    console.error(`[Sync Endpoint] Task ${taskId} failed on Kie.ai: ${failReason}`);

                    // A. Mark asset as 'Failed'
                    if (task.asset_id) {
                        await supabaseAdmin
                            .from('assets')
                            .update({ 
                                status: 'Failed',
                                caption: `Failed during sync: ${failReason}` 
                            })
                            .eq('id', task.asset_id);
                    }

                    // B. Delete video task
                    await supabaseAdmin.from('video_tasks').delete().eq('id', task.id);

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
