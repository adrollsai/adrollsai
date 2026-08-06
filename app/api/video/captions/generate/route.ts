import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { transcribeVideoWithGemini } from '@/utils/gemini-video';
import { optimizeCaptionsForRetention } from '@/utils/caption-optimizer';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { videoUrl, assetId } = await request.json();

        if (!videoUrl) {
            return NextResponse.json({ error: 'Missing video URL' }, { status: 400 });
        }

        const currentMetadata = assetId 
            ? ((await supabaseAdmin.from('assets').select('metadata').eq('id', assetId).single()).data?.metadata || {})
            : {};
        const audioUrl = currentMetadata?.audioUrl || null;

        // 1. Get Raw Transcript using Gemini
        console.log(`[Captions API] Transcribing video (audioUrl: ${audioUrl || 'none'})...`);
        const rawTranscript = await transcribeVideoWithGemini(videoUrl, audioUrl);

        // 2. Optimize for Viral Retention & Visual Effects
        console.log(`[Captions API] Optimizing captions and effects...`);
        const { captions, effects } = await optimizeCaptionsForRetention(rawTranscript.segments);

        // 3. Store in Supabase via Admin Client (bypassing RLS for impersonated assets)
        if (assetId) {
            const { error: dbError } = await supabaseAdmin
                .from('assets')
                .update({ 
                    metadata: { 
                        ...currentMetadata,
                        captions: captions,
                        effects: effects 
                    } 
                })
                .eq('id', assetId);

            if (dbError) console.warn("[Captions API] DB update error:", dbError);
        }

        return NextResponse.json({ 
            success: true, 
            captions,
            effects
        });

    } catch (error: any) {
        console.error("[Captions API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
