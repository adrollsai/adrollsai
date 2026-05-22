import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { transcribeVideoWithGemini } from '@/utils/gemini-video';
import { optimizeCaptionsForRetention } from '@/utils/caption-optimizer';

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

        // 1. Get Raw Transcript
        console.log(`[Captions API] Transcribing video...`);
        const rawTranscript = await transcribeVideoWithGemini(videoUrl);

        // 2. Optimize for Viral Retention & Visual Effects
        console.log(`[Captions API] Optimizing captions and effects...`);
        const { captions, effects } = await optimizeCaptionsForRetention(rawTranscript.segments);

        // 3. Store in Supabase
        const currentMetadata = (await supabase.from('assets').select('metadata').eq('id', assetId).single()).data?.metadata || {};
        const { error: dbError } = await supabase
            .from('assets')
            .update({ 
                metadata: { 
                    ...currentMetadata,
                    captions: captions,
                    effects: effects 
                } 
            })
            .eq('id', assetId);

        if (dbError) throw dbError;

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
