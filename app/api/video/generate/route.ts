import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createVeoTask } from '@/utils/external-apis';
import { checkLimitAndIncrement } from '@/utils/subscription-server';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { 
            propertyId, 
            prompts, // Array of 4 prompts
            aspectRatio = '9:16' 
        } = body;

        if (!prompts || prompts.length !== 4) {
            return NextResponse.json({ error: 'Invalid script provided' }, { status: 400 });
        }

        // --- QUOTA CHECK ---
        try {
            await checkLimitAndIncrement(user.id, 'ai_creatives');
        } catch (limitErr: any) {
            return NextResponse.json({ error: limitErr.message }, { status: 403 });
        }

        // 1. Create Placeholder Asset (Spinning Card)
        const { data: asset, error: assetError } = await supabase
            .from('assets')
            .insert({
                user_id: user.id,
                property_id: propertyId || null,
                type: 'video',
                status: 'Processing',
                url: 'https://designs.adrolls.in/processing', // Temporary URL
                caption: prompts.join('\n\n')
            })
            .select()
            .single();

        if (assetError || !asset) {
            console.error("Placeholder creation failed:", assetError);
            return NextResponse.json({ error: "Failed to initialize video asset" }, { status: 500 });
        }

        // 2. Initiate First Veo Task
        const publicUrl = process.env.NEXT_PUBLIC_APP_URL;
        const baseUrl = (publicUrl && publicUrl.startsWith('http') && !publicUrl.includes('localhost')) 
            ? publicUrl 
            : new URL(request.url).origin;
            
        const callbackUrl = `${baseUrl}/api/video/callback`;

        console.log(`[Video Generate] Source Origin: ${new URL(request.url).origin}, Selected Base: ${baseUrl}`);
        console.log(`[Video Generate] Using callback URL: ${callbackUrl}`);
        
        if (baseUrl.includes('localhost')) {
            console.warn("[Video Generate] WARNING: Using localhost for callback! Kie.ai will NOT be able to reach your server. Please set NEXT_PUBLIC_APP_URL to your ngrok URL.");
        }

        const firstPayload = {
            prompt: prompts[0],
            model: "veo3_lite", // Generation requires veo3_lite
            resolution: "720p",
            aspect_ratio: "9:16", 
            callBackUrl: callbackUrl
        };

        const { taskId, error: kieError } = await createVeoTask(firstPayload);

        if (kieError || !taskId) {
            // Delete the placeholder if task failed to start
            await supabase.from('assets').delete().eq('id', asset.id);
            return NextResponse.json({ error: kieError || "Failed to start video generation" }, { status: 500 });
        }

        // 3. Record State in video_tasks
        const { error: dbError } = await supabase
            .from('video_tasks')
            .insert({
                id: crypto.randomUUID(),
                user_id: user.id,
                property_id: propertyId || null,
                asset_id: asset.id,
                prompts: prompts,
                current_index: 0,
                last_task_id: taskId,
                aspect_ratio: aspectRatio,
                status: 'Processing'
            });

        if (dbError) {
            console.error("DB Error saving video task:", dbError);
        }

        return NextResponse.json({ 
            success: true, 
            assetId: asset.id,
            taskId, 
            message: "Video generation started. Scene 1 in progress." 
        });

    } catch (error: any) {
        console.error("Video Generate Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
