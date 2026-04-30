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

        // 4. Send the Native Web Push Notification
        const notifTitle = propertyTitle ? `✨ Asset Ready: ${propertyTitle}` : `✨ AI Creative Ready!`;
        const notifBody = propertyTitle ? `Your AI poster for ${propertyTitle} is ready to publish!` : `Your requested AI design has finished generating in the background.`;

        await sendPushNotification(
            userId, 
            notifTitle, 
            notifBody,
            '/dashboard/assets',
            'asset_ready'
        );

        return NextResponse.json({ success: true, url: finalImageUrl });

    } catch (error: any) {
        console.error("Background Worker Fatal Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}