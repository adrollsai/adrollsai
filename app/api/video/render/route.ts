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

        // 1. Retrieve original asset context details
        const { data: originalAsset, error: fetchErr } = await supabase
            .from('assets')
            .select('*')
            .eq('id', assetId)
            .single();

        if (fetchErr || !originalAsset) {
            return NextResponse.json({ error: 'Original video asset not found.' }, { status: 404 });
        }

        // 1.5. Create a NEW Asset placeholder in Supabase for the rendered video,
        // so that the original unedited video is NOT overwritten!
        const { data: newAsset, error: newAssetError } = await supabase
            .from('assets')
            .insert({
                user_id: originalAsset.user_id,
                property_id: originalAsset.property_id || null,
                type: 'video',
                status: 'Rendering',
                url: originalAsset.url, // Point temporarily to original source video URL
                caption: `${originalAsset.caption || ''} (AI Edited)`
            })
            .select()
            .single();

        if (newAssetError || !newAsset) {
            return NextResponse.json({ error: `Failed to initialize edited asset placeholder: ${newAssetError?.message}` }, { status: 500 });
        }

        console.log(`[Render Route] Preparing rendering delegation. Original: ${assetId}, New: ${newAsset.id}`);

        // 2. Retrieve User Profile Details for the Outro screen (respecting asset owner / impersonation)
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', originalAsset.user_id)
            .single();

        // 3. Retrieve Visual Effects (fallback to client effects or db metadata)
        let effects = clientEffects || [];
        if (!effects || effects.length === 0) {
            if (originalAsset?.metadata?.effects) {
                effects = originalAsset.metadata.effects;
            }
        }

        // 4. Send Asynchronous Render Request to Google Cloud Run Worker
        const rendererUrl = process.env.REMOTION_RENDERER_URL || 'http://127.0.0.1:8080';
        console.log(`[Render Route] Dispatching payload to Cloud Run at: ${rendererUrl}/render`);

        try {
            const response = await fetch(`${rendererUrl.replace(/\/$/, '')}/render`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assetId: newAsset.id, // PASS THE NEW ASSET ID!
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

            // Revert new asset status back to 'Failed'
            await supabase
                .from('assets')
                .update({ status: 'Failed' })
                .eq('id', newAsset.id);

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
