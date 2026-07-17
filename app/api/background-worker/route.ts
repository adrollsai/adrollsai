import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/utils/supabase/server';
import { sendPushNotification } from '@/utils/notification-helper';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { refundLimit } from '@/utils/subscription-server';
import sharp from 'sharp';

// IMPORTANT: Prevents Vercel from timing out the request before generation finishes
export const maxDuration = 300; 

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
    try {
        const body = await req.json();
        console.log("[Worker] Request received:", JSON.stringify(body, null, 2));
        // Accept either payload (from Products) OR existingTaskId (from Creation Chat)
        const { userId, propId, propertyTitle, payload, existingTaskId, existingCaption, batchId } = body;

        const host = req.headers.get('host') || 'localhost:3000';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const baseUrl = `${protocol}://${host}`; 
        const cookieHeader = req.headers.get('cookie') || '';

        let taskId = existingTaskId;
        let generatedCaption = existingCaption || '';

        // 1. Start the Chat Generation IF coming from the Products Tab (no taskId passed)
        if (!taskId && payload) {
            const supabase = await createServerClient();
            const { data: { user } } = await supabase.auth.getUser();
            const loggedInUserId = user?.id;

            const urlParams = new URL(req.url).searchParams;
            const impersonateParam = urlParams.get('impersonate') || (userId && loggedInUserId && userId !== loggedInUserId ? userId : null);
            const chatUrl = impersonateParam ? `${baseUrl}/api/chat?impersonate=${impersonateParam}` : `${baseUrl}/api/chat`;

            console.log(`[Worker] Starting generation for ${propertyTitle} at ${chatUrl}`);
            const startResponse = await fetch(chatUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Cookie': cookieHeader 
                },
                body: JSON.stringify({
                    ...payload,
                    impersonateId: impersonateParam
                })
            });
            
            const startData = await startResponse.json();
            
            if (startData.error || !startData.taskId) {
                 return NextResponse.json({ error: startData.error || 'Failed to start AI task' }, { status: 400 });
            }

            taskId = startData.taskId;
            generatedCaption = startData.caption || '';
        }

        if (!taskId) {
            return NextResponse.json({ error: 'No Task ID provided or generated.' }, { status: 400 });
        }

        // --- NEW: PERSISTENCE-FIRST PLACEHOLDER ---
        // Create the record immediately so that if the worker times out, the task ID is not lost.
        const { data: placeholder, error: placeholderError } = await supabaseAdmin.from('assets').insert({
            user_id: userId,
            property_id: propId || null,
            kie_task_id: taskId,
            type: 'image',
            status: 'Processing',
            url: 'https://designs.adrolls.in/processing', // Temporary URL to satisfy NOT NULL constraint
            caption: generatedCaption,
            metadata: body.payload?.socialCaption ? { social_caption: body.payload.socialCaption } : {}
        }).select().single();

        if (placeholderError) {
            console.error("[Worker] Failed to create placeholder asset:", placeholderError);
        }

        // Launch asynchronous background process to avoid blocking connections
        (async () => {
            try {
                let attempts = 0;
                let finalImageUrl = '';

                // 2. Poll for Status ON THE SERVER
                // Poll every 10 seconds for up to 29 attempts (~290 seconds total)
                while (attempts < 29) {
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    
                    const checkResponse = await fetch(`${baseUrl}/api/check-status`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Cookie': cookieHeader 
                        },
                        body: JSON.stringify({ taskId })
                    });
                    const checkData = await checkResponse.json();

                    // The Kie.ai API response usually has status at the root or within data
                    const status = checkData.status || checkData.data?.status || checkData.data?.state;
                    
                    if (status === 'succeeded' || status === 'completed' || status === 'success') {
                        // Robust extraction of the URL
                        const result = checkData.result || checkData.data?.result || checkData.data;
                        
                        finalImageUrl = result?.image_url || 
                                       result?.output_url || 
                                       result?.url || 
                                       (typeof result === 'string' && result.startsWith('http') ? result : null);

                        // Check resultJson fallback (used in some versions)
                        if (!finalImageUrl && checkData.data?.resultJson) {
                            try {
                                const parsed = JSON.parse(checkData.data.resultJson);
                                finalImageUrl = parsed.resultUrls?.[0] || parsed.url;
                            } catch(e) {}
                        }

                        if (finalImageUrl) {
                            console.log("[Worker] Found Image URL:", finalImageUrl);
                            break;
                        }
                    } else if (status === 'failed' || status === 'error') {
                        const failReason = checkData.failMsg || checkData.error || checkData.msg || "Unknown Kie.ai Error";
                        console.error(`[Worker] Generation Failed for taskId ${taskId}:`, failReason);
                        
                        // REFUND: Task failed on Kie AI's side (e.g. content policy or server error)
                        await refundLimit(userId, 'images');
                        try {
                            const { addCredits } = await import('@/utils/credits');
                            await addCredits(supabaseAdmin, userId, 30, 'ai_generation', 'Refund: AI Image Generation failed (Design server error)');
                        } catch (refundErr) {
                            console.error("Failed to refund credits in background worker:", refundErr);
                        }

                        // Update placeholder to Failed so user knows it won't finish
                        if (placeholder?.id) {
                            await supabaseAdmin.from('assets').update({ 
                                status: 'Failed',
                                caption: `Error: ${failReason}` 
                            }).eq('id', placeholder.id);
                        }
                        break;
                    }
                }

                if (!finalImageUrl) {
                     console.error("[Worker] Polling finished but no finalImageUrl found.");
                     await refundLimit(userId, 'images');
                     try {
                         const { addCredits } = await import('@/utils/credits');
                         await addCredits(supabaseAdmin, userId, 30, 'ai_generation', 'Refund: AI Image Generation failed (Timeout)');
                     } catch (refundErr) {
                         console.error("Failed to refund credits on timeout in background worker:", refundErr);
                     }
                     if (placeholder?.id) {
                         await supabaseAdmin.from('assets').update({ 
                             status: 'Failed',
                             caption: 'Error: Generation Timed Out' 
                         }).eq('id', placeholder.id);
                     }
                     return;
                }

                console.log("[Worker] Successfully found image URL:", finalImageUrl);

                // --- COMPRESS & PERSIST TO R2 ---
                let persistedUrl = finalImageUrl;
                try {
                    console.log("[Worker] Fetching image for compression and R2 persistence...");
                    const imgRes = await fetch(finalImageUrl);
                    const rawBuffer = Buffer.from(await imgRes.arrayBuffer());
                    
                    let compressedBuffer: any = rawBuffer;
                    let finalFileName = `generated/${userId}/${Date.now()}.jpg`;
                    let contentType = 'image/jpeg';
                    
                    try {
                        console.log("[Worker] Compressing image with sharp (quality 80, resize to max 1200px)...");
                        compressedBuffer = await sharp(rawBuffer)
                            .resize({ width: 1200, withoutEnlargement: true })
                            .jpeg({ quality: 80, progressive: true })
                            .toBuffer();
                        console.log("[Worker] Compression complete. Size reduction: from", rawBuffer.length, "to", compressedBuffer.length);
                    } catch (sharpErr) {
                        console.error("[Worker] sharp compression failed, using original png format:", sharpErr);
                        finalFileName = `generated/${userId}/${Date.now()}.png`;
                        contentType = 'image/png';
                    }

                    await r2.send(new PutObjectCommand({
                        Bucket: R2_BUCKET,
                        Key: finalFileName,
                        Body: compressedBuffer,
                        ContentType: contentType
                    }));
                    
                    persistedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${finalFileName}`;
                    console.log("[Worker] Successfully persisted to R2:", persistedUrl);
                } catch (r2Error) {
                    console.error("[Worker] R2 Persistence Failed, using original URL:", r2Error);
                }

                // 3. Finalize Asset in DB
                try {
                    if (batchId && batchId.length === 36) {
                        await supabaseAdmin.from('master_creatives').upsert({
                            id: batchId,
                            property_id: propId,
                            url: persistedUrl,
                            type: 'image',
                            is_active: true
                        }, { onConflict: 'id' });
                    }

                    let dbResult;
                    if (placeholder?.id) {
                        dbResult = await supabaseAdmin.from('assets').update({
                            master_creative_id: (batchId && batchId.length === 36) ? batchId : null,
                            url: persistedUrl,
                            status: 'Draft',
                            caption: generatedCaption,
                            metadata: body.payload?.socialCaption ? { social_caption: body.payload.socialCaption } : {}
                        }).eq('id', placeholder.id);
                    } else {
                        dbResult = await supabaseAdmin.from('assets').insert({
                            user_id: userId,
                            property_id: propId || null,
                            master_creative_id: (batchId && batchId.length === 36) ? batchId : null,
                            url: persistedUrl,
                            type: 'image',
                            status: 'Draft',
                            caption: generatedCaption,
                            metadata: body.payload?.socialCaption ? { social_caption: body.payload.socialCaption } : {}
                        });
                    }

                    if (dbResult.error) {
                        console.error("[Worker] Asset Update/Insert Error:", dbResult.error);
                    } else {
                        console.log("[Worker] Successfully finalized asset in database.");
                    }
                } catch (dbErr) {
                    console.error("[Worker] Database Operation Failed:", dbErr);
                }

                // 4. OPTIONAL: Push to Meta Ads Campaign
                const { metaCampaignId, metaLeadFormId } = body;
                let pushSuccess = false;

                if (metaCampaignId) {
                    try {
                        const { data: profile } = await supabaseAdmin.from('profiles').select('facebook_token, ad_account_id, selected_page_id, custom_domain').eq('id', userId).single();
                        
                        if (profile?.facebook_token && profile?.ad_account_id) {
                            const FB_URL = "https://graph.facebook.com/v19.0";
                            
                            const imgFetch = await fetch(persistedUrl);
                            const imgBlob = await imgFetch.blob();
                            const uploadData = new FormData();
                            uploadData.append('source', imgBlob, `ai_opt_${Date.now()}.png`);
                            uploadData.append('access_token', profile.facebook_token);
                            
                            const uploadRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adimages`, { method: 'POST', body: uploadData });
                            const uploadResult = await uploadRes.json();
                            const imgHash = uploadResult.images?.[Object.keys(uploadResult.images)[0]]?.hash;

                            if (imgHash) {
                                const adSetsRes = await fetch(`${FB_URL}/${metaCampaignId}/adsets?fields=id&access_token=${profile.facebook_token}`);
                                const adSetsData = await adSetsRes.json();
                                const adSetId = adSetsData.data?.[0]?.id;

                                if (adSetId) {
                                    const [headline, ...rest] = generatedCaption.split('\n\n');
                                    const primaryText = rest.join('\n\n') || headline;

                                    const targetBusinessUrl = profile.custom_domain 
                                        ? `https://${profile.custom_domain}` 
                                        : `https://app.nobogent.com/shared/${userId}`;

                                    const creativePayload = {
                                        name: `AI Opt - ${propertyTitle || 'Variation'}`,
                                        object_story_spec: {
                                            page_id: profile.selected_page_id,
                                            link_data: {
                                                message: primaryText,
                                                name: headline,
                                                link: targetBusinessUrl,
                                                image_hash: imgHash,
                                                call_to_action: { type: 'LEARN_MORE', value: { lead_gen_form_id: metaLeadFormId } }
                                            }
                                        },
                                        access_token: profile.facebook_token
                                    };

                                    const creativeRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adcreatives`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(creativePayload)
                                    });
                                    const creativeData = await creativeRes.json();

                                    if (creativeData.id) {
                                        const adPayload = {
                                            name: `AI Optimized Variation - ${Date.now()}`,
                                            adset_id: adSetId,
                                            creative: { creative_id: creativeData.id },
                                            status: 'PAUSED',
                                            access_token: profile.facebook_token
                                        };
                                        const adRes = await fetch(`${FB_URL}/${profile.ad_account_id}/ads`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(adPayload)
                                        });
                                        if (adRes.ok) pushSuccess = true;
                                    }
                                }
                            }
                        }
                    } catch (err) { console.error("[Worker] Meta Push Failed:", err); }
                }

                // 5. Send Notification
                const notifTitle = pushSuccess ? `🚀 Ad Optimized: ${propertyTitle}` : `✨ Creative Ready: ${propertyTitle}`;
                const notifBody = pushSuccess 
                    ? `Your new AI-optimized ad for ${propertyTitle} has been pushed to Meta (Paused).`
                    : `Your requested AI design for ${propertyTitle} is ready.`;

                await sendPushNotification(userId, notifTitle, notifBody, pushSuccess ? '/dashboard/ads' : '/dashboard/assets', 'asset_ready');

            } catch (err) {
                console.error("[Worker Background Loop Fatal Error]:", err);
            }
        })();

        // Return 202 Accepted immediately to release the client-side fetch block
        return NextResponse.json({ success: true, message: 'Generation started in the background.', taskId }, { status: 202 });

    } catch (error: any) {
        console.error("Background Worker Fatal Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}