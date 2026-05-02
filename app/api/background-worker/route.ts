import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushNotification } from '@/utils/notification-helper';

// IMPORTANT: Prevents Vercel from timing out the request before generation finishes
export const maxDuration = 300; 

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
    try {
        const body = await req.json();
        // Accept either payload (from Products) OR existingTaskId (from Creation Chat)
        const { userId, propId, propertyTitle, payload, existingTaskId, existingCaption } = body;

        const requestUrl = new URL(req.url);
        const baseUrl = requestUrl.origin; 
        const cookieHeader = req.headers.get('cookie') || '';

        let taskId = existingTaskId;
        let generatedCaption = existingCaption || '';

        // 1. Start the Chat Generation IF coming from the Products Tab (no taskId passed)
        if (!taskId && payload) {
            console.log(`[Worker] Starting generation for ${propertyTitle} at ${baseUrl}/api/chat`);
            const startResponse = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Cookie': cookieHeader 
                },
                body: JSON.stringify(payload)
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

        let attempts = 0;
        let finalImageUrl = '';

        // 2. Poll for Status ON THE SERVER (Unhindered by locked phones)
        while (attempts < 30) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 4000));
            
            const checkResponse = await fetch(`${baseUrl}/api/check-status`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Cookie': cookieHeader 
                },
                body: JSON.stringify({ taskId })
            });
            const checkData = await checkResponse.json();

            if (checkData.data?.state === 'success') {
                if (checkData.data.resultJson) {
                    try {
                        const resultObj = JSON.parse(checkData.data.resultJson);
                        if (resultObj.resultUrls?.[0]) finalImageUrl = resultObj.resultUrls[0];
                    } catch(e) {}
                } else if (checkData.data.resultUrl) {
                    finalImageUrl = checkData.data.resultUrl;
                }
                break;
            } else if (checkData.data?.state === 'failed') {
                console.error("[Worker] Generation Failed via API:", checkData.data.failMsg);
                break;
            }
        }

        if (!finalImageUrl) {
             return NextResponse.json({ error: 'Generation Timed Out' }, { status: 408 });
        }

        // 3. Save directly to DB via Server Admin
        await supabaseAdmin.from('assets').insert({
            user_id: userId,
            property_id: propId || null,
            url: finalImageUrl,
            type: 'image',
            status: 'Draft',
            caption: generatedCaption
        });

        // 4. OPTIONAL: Push to Meta Ads Campaign
        const { metaCampaignId, metaLeadFormId } = body;
        let pushSuccess = false;

        if (metaCampaignId) {
            try {
                // Fetch Meta Credentials
                const { data: profile } = await supabaseAdmin.from('profiles').select('facebook_token, ad_account_id, fb_page_id, business_url').eq('id', userId).single();
                
                if (profile?.facebook_token && profile?.ad_account_id) {
                    const FB_URL = "https://graph.facebook.com/v19.0";
                    
                    // A. Upload Image to Meta
                    const imgFetch = await fetch(finalImageUrl);
                    const imgBlob = await imgFetch.blob();
                    const uploadData = new FormData();
                    uploadData.append('source', imgBlob, `ai_opt_${Date.now()}.png`);
                    uploadData.append('access_token', profile.facebook_token);
                    
                    const uploadRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adimages`, { method: 'POST', body: uploadData });
                    const uploadResult = await uploadRes.json();
                    const imgHash = uploadResult.images?.[Object.keys(uploadResult.images)[0]]?.hash;

                    if (imgHash) {
                        // B. Get First Ad Set
                        const adSetsRes = await fetch(`${FB_URL}/${metaCampaignId}/adsets?fields=id&access_token=${profile.facebook_token}`);
                        const adSetsData = await adSetsRes.json();
                        const adSetId = adSetsData.data?.[0]?.id;

                        if (adSetId) {
                            const [headline, ...rest] = generatedCaption.split('\n\n');
                            const primaryText = rest.join('\n\n') || headline;

                            const creativePayload = {
                                name: `AI Opt - ${propertyTitle || 'Variation'}`,
                                object_story_spec: {
                                    page_id: profile.fb_page_id,
                                    link_data: {
                                        message: primaryText,
                                        name: headline,
                                        link: profile.business_url || 'https://adrolls.in',
                                        image_hash: imgHash,
                                        call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: metaLeadFormId } }
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

        return NextResponse.json({ success: true, url: finalImageUrl, pushed: pushSuccess });

    } catch (error: any) {
        console.error("Background Worker Fatal Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}