import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { assetId, videoUrl, captions, effects: clientEffects, theme } = await request.json();

        if (!assetId || !videoUrl || !captions || !theme) {
            return NextResponse.json({ error: 'Missing required parameters: assetId, videoUrl, captions, and theme are required.' }, { status: 400 });
        }

        console.log(`[Render Route] Preparing rendering delegation for Asset: ${assetId}`);

        // 1. Retrieve User Profile Details for the Outro screen
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        // 2. Retrieve Visual Effects (fallback to client effects or db metadata)
        let effects = clientEffects || [];
        if (!effects || effects.length === 0) {
            const { data: assetData } = await supabase
                .from('assets')
                .select('metadata')
                .eq('id', assetId)
                .single();
            if (assetData?.metadata?.effects) {
                effects = assetData.metadata.effects;
            }
        }

        // 3. Update Asset Status to 'Rendering' in database
        await supabase
            .from('assets')
            .update({ status: 'Rendering' })
            .eq('id', assetId);

        // 4. Send Asynchronous Render Request to Google Cloud Run Worker
        const rendererUrl = process.env.REMOTION_RENDERER_URL || 'http://localhost:8080';
        console.log(`[Render Route] Dispatching payload to Cloud Run at: ${rendererUrl}/render`);

        try {
            const response = await fetch(`${rendererUrl.replace(/\/$/, '')}/render`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assetId,
                    videoUrl,
                    captions,
                    effects,
                    theme,
                    profile: profile || {}
                })
            });

            const resData = await response.json();
            if (!response.ok || !resData.success) {
                throw new Error(resData.error || `Cloud Run worker returned status ${response.status}`);
            }

            console.log(`[Render Route] Successfully delegated render to Cloud Run:`, resData.message);

            return NextResponse.json({
                success: true,
                message: "Render successfully dispatched to cloud backend."
            });

        } catch (workerError: any) {
            console.error(`[Render Route] Worker delegation failed:`, workerError);

            // Revert asset status back to 'Failed'
            await supabase
                .from('assets')
                .update({ status: 'Failed' })
                .eq('id', assetId);

            return NextResponse.json({
                success: false,
                error: `Failed to initiate cloud rendering worker: ${workerError.message}`
            }, { status: 502 });
        }

    } catch (error: any) {
        console.error("[Render Route] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
