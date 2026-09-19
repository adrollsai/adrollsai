import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { transcribeVideoWithGemini } from '@/utils/gemini-video';
import { optimizeCaptionsForRetention } from '@/utils/caption-optimizer';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 60; // Allow 60s for audio transcription and caption styling on Vercel

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { videoUrl, assetId, language = 'hinglish' } = await request.json();

        if (!videoUrl) {
            return NextResponse.json({ error: 'Missing video URL' }, { status: 400 });
        }

        const currentMetadata = assetId 
            ? ((await supabaseAdmin.from('assets').select('metadata').eq('id', assetId).single()).data?.metadata || {})
            : {};
        const audioUrl = currentMetadata?.audioUrl || null;

        // 1. Get Word-Level Transcript using Gemini 3.8 Flash in selected language (audio-first)
        console.log(`[Captions API] Transcribing audio with Gemini 3.8 Flash (language: ${language}, audioUrl: ${audioUrl || 'none'})...`);
        const rawTranscript = await transcribeVideoWithGemini(videoUrl, audioUrl, language);

        // 2. Optimize for Viral Retention & Visual Effects in target language
        console.log(`[Captions API] Optimizing captions and effects in ${language}...`);
        const { captions, effects } = await optimizeCaptionsForRetention(rawTranscript?.segments || [], language);

        // 3. Store in Supabase via Admin Client (bypassing RLS for impersonated assets)
        if (assetId) {
            const { error: dbError } = await supabaseAdmin
                .from('assets')
                .update({ 
                    metadata: { 
                        ...currentMetadata,
                        captions: captions,
                        effects: effects,
                        words: rawTranscript?.words || []
                    } 
                })
                .eq('id', assetId);

            if (dbError) console.warn("[Captions API] DB update error:", dbError);
        }

        return NextResponse.json({ 
            success: true, 
            captions,
            effects,
            words: rawTranscript?.words || []
        });

    } catch (error: any) {
        console.error("[Captions API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
