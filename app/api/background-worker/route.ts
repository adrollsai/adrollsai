// app/api/background-worker/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushNotification } from '@/utils/notification-helper';

// IMPORTANT: Prevents Vercel from timing out the request before generation finishes
// (Note: Requires Vercel Pro. If on Hobby, it will timeout at 10s. If you are on a VPS/Custom Server, this is ignored and runs indefinitely.)
export const maxDuration = 300; 

// We use the Service Role key to bypass Row Level Security since this runs in the background
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { userId, propId, propertyTitle, payload } = body;

        // Base URL for internal routing
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || req.headers.get('origin') || 'https://adrolls.in';
        
        // 1. Start the Chat Generation
        const startResponse = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const startData = await startResponse.json();
        
        if (startData.error || !startData.taskId) {
             return NextResponse.json({ error: 'Failed to start AI task' }, { status: 400 });
        }

        const taskId = startData.taskId;
        const generatedCaption = startData.caption || '';
        let attempts = 0;
        let finalImageUrl = '';

        // 2. Poll for Status ON THE SERVER (Unaffected by phone locks)
        while (attempts < 30) {
            attempts++;
            // Wait 4 seconds between checks
            await new Promise(resolve => setTimeout(resolve, 4000));
            
            const checkResponse = await fetch(`${baseUrl}/api/check-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                break; // Exit loop on success
            } else if (checkData.data?.state === 'failed') {
                console.error("Worker Generation Failed", checkData.data.failMsg);
                break;
            }
        }

        if (!finalImageUrl) {
             return NextResponse.json({ error: 'Generation Timed Out' }, { status: 408 });
        }

        // 3. Save directly to DB via Server Admin
        await supabaseAdmin.from('assets').insert({
            user_id: userId,
            property_id: propId,
            url: finalImageUrl,
            type: 'image',
            status: 'Draft',
            caption: generatedCaption
        });

        // 4. Send the Native Web Push Notification to wake the locked phone
        await sendPushNotification(
            userId, 
            "✨ Asset Generation Complete", 
            `Your AI poster for ${propertyTitle} is ready to publish!`,
            '/dashboard/assets',
            'asset_ready'
        );

        return NextResponse.json({ success: true, url: finalImageUrl });

    } catch (error: any) {
        console.error("Background Worker Fatal Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}