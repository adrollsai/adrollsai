import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createGeminiTTS, queryKieTask } from '@/utils/external-apis';
import { withMediaFallback } from '@/lib/agent/media-models';
import { languageCodeFor, spokenScript, synthesizeSpeech } from '@/lib/media/gemini-tts-direct';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Store a finished voiceover where Remotion Lambda can reach it.
 *
 * Both engines land here, so the R2 key scheme and the MP3 normalisation cannot drift apart
 * between the direct path and the fallback.
 */
async function persistVoiceover(rawBuffer: Buffer, hint: string): Promise<string> {
    const { ensureMp3AudioBuffer } = await import('@/utils/audio-converter');
    const audioBuffer = await ensureMp3AudioBuffer(rawBuffer);
    const { r2, R2_BUCKET, R2_PUBLIC_URL } = await import('@/utils/r2');
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const r2Key = `voiceover/${Date.now()}_${hint}.mp3`;
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: audioBuffer,
        ContentType: 'audio/mpeg'
    }));
    return `${R2_PUBLIC_URL}/${r2Key}`;
}

export async function POST(request: Request) {
    try {
        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');

        let user: any = null;
        const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '').trim();
            if (token) {
                const { data: userData, error: tokenErr } = await supabaseAdmin.auth.getUser(token);
                if (!tokenErr && userData?.user) {
                    user = userData.user;
                }
            }
        }

        if (!user) {
            const supabase = await createClient();
            const { data: userData } = await supabase.auth.getUser();
            user = userData?.user || null;
        }

        if (!user && !impersonateId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            dialogueText,
            speakerName = "Aoede",
            style = "",
            accent = "indian",
            language = "hinglish",
            scene,
            sampleContext
        } = body;

        if (!dialogueText || typeof dialogueText !== 'string' || dialogueText.trim().length === 0) {
            return NextResponse.json({ error: 'Dialogue text is required for voiceover generation.' }, { status: 400 });
        }

        const isIndianAccent = accent === 'indian' || language === 'english_in' || language === 'indian_english' || (!accent && (language === 'hinglish' || language === 'hindi' || language === 'punjabi' || language === 'tamil' || language === 'telugu' || language === 'kannada' || language === 'marathi' || language === 'bengali' || language === 'gujarati'));

        const effectiveScene = scene || (isIndianAccent
            ? "A confident, polished Indian voiceover artist speaking fluent Indian English in a professional recording studio. Warm, clear, enthusiastic, natural Indian vocal cadence, and convincing tone for a high-converting commercial."
            : "A professional commercial voiceover studio with warm, clear, and engaging tonality.");

        const effectiveContext = sampleContext || (isIndianAccent
            ? "High converting luxury marketing video commercial with natural Indian English delivery"
            : "High converting commercial marketing video");

        console.log(`[Grok TTS API] Creating voiceover task (Speaker: ${speakerName}, Accent: ${isIndianAccent ? 'Indian' : 'American'}, Text length: ${dialogueText.length})...`);

        /**
         * GOOGLE FIRST, KIE ONLY IF GOOGLE IS UNAVAILABLE.
         *
         * The same model (gemini-3.8-flash-tts) through Google's own endpoint is one request that
         * returns the audio. Kie's wrapper is a queued task we poll for 45 seconds, and when it is
         * slow it fails with "generate task timeout" — after the owner pressed the button and long
         * before they see a video. Direct is faster and has nothing to time out, so it goes first;
         * Kie stays as the fallback for a Google quota or permission problem.
         */
        const directStarted = Date.now();
        const direct = await synthesizeSpeech({
            text: spokenScript({
                dialogueText,
                style: [style, effectiveScene].filter(Boolean).join('. '),
                scene: effectiveContext
            }),
            voiceName: speakerName,
            languageCode: languageCodeFor({ accent, language })
        });

        if (direct.ok) {
            try {
                const audioUrl = await persistVoiceover(direct.wav, `gemini_direct_${direct.model}`);
                console.log(
                    `[Grok TTS API] Direct ${direct.model} voiceover ready in ${Date.now() - directStarted}ms (${direct.wav.length} bytes) — ${audioUrl}`
                );
                return NextResponse.json({
                    success: true,
                    status: 'completed',
                    engine: 'gemini-direct',
                    model: direct.model,
                    audioUrl
                });
            } catch (persistError: any) {
                // The audio exists but could not be stored. Falling through to Kie would generate (and
                // bill) a second voiceover for the same request, so report it instead.
                console.error('[Grok TTS API] Direct TTS produced audio but storage failed:', persistError);
                return NextResponse.json(
                    { error: `The voiceover was generated but could not be saved: ${persistError?.message || persistError}` },
                    { status: 500 }
                );
            }
        }

        console.warn(
            `[Grok TTS API] Direct Gemini TTS unavailable (${direct.status ?? 'no status'}, retryable=${direct.retryable}): ` +
                `${direct.error} — falling back to Kie.`
        );

        // Primary model, one retry on a 524 / 'generate task timeout', then the
        // registry's fallback — all decided in lib/agent/media-models.ts.
        const ttsRoute = await withMediaFallback(
            'voice',
            (model) => createGeminiTTS({
                dialogueText: dialogueText.trim(),
                speakerName,
                style,
                scene: effectiveScene,
                sampleContext: effectiveContext,
                model
            }),
            { label: 'tts' }
        );

        const taskId = ttsRoute.value?.taskId || null;
        if (!ttsRoute.ok || !taskId) {
            return NextResponse.json({ error: ttsRoute.reason || 'Failed to create TTS voiceover task.' }, { status: 500 });
        }

        console.log(`[Grok TTS API] Task created with ${ttsRoute.model}${ttsRoute.fellBack ? ' (fallback)' : ''} — ID ${taskId}. Polling for completion...`);

        // Poll task status (up to 45 seconds: 15 attempts x 3s)
        let attempts = 0;
        let audioUrl: string | null = null;
        let pollError: string | null = null;

        while (attempts < 15) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            const statusRes = await queryKieTask(taskId);

            if (statusRes.state === 'success' && statusRes.resultUrl) {
                const rawAudioUrl = statusRes.resultUrl;
                console.log(`[Grok TTS API] Task ${taskId} succeeded raw: ${rawAudioUrl}`);
                
                // Persist audio to Cloudflare R2 for reliable Remotion Lambda playback
                try {
                    const audioRes = await fetch(rawAudioUrl);
                    if (audioRes.ok) {
                        const rawAudioBuffer = Buffer.from(await audioRes.arrayBuffer());
                        const { ensureMp3AudioBuffer } = await import('@/utils/audio-converter');
                        const audioBuffer = await ensureMp3AudioBuffer(rawAudioBuffer);
                        const { r2, R2_BUCKET, R2_PUBLIC_URL } = await import('@/utils/r2');
                        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
                        const r2Key = `voiceover/${Date.now()}_${taskId}.mp3`;
                        
                        await r2.send(new PutObjectCommand({
                            Bucket: R2_BUCKET,
                            Key: r2Key,
                            Body: audioBuffer,
                            ContentType: 'audio/mpeg'
                        }));
                        audioUrl = `${R2_PUBLIC_URL}/${r2Key}`;
                        console.log(`[Grok TTS API] Voiceover persisted to Cloudflare R2: ${audioUrl}`);
                    } else {
                        audioUrl = rawAudioUrl;
                    }
                } catch (r2Err) {
                    console.error("[Grok TTS API] R2 persistence error, using raw URL:", r2Err);
                    audioUrl = rawAudioUrl;
                }
                break;
            }

            if (statusRes.state === 'fail') {
                pollError = statusRes.error || 'Voiceover generation failed on Kie server.';
                console.error(`[Grok TTS API] Task ${taskId} failed: ${pollError}`);
                break;
            }

            attempts++;
        }

        if (!audioUrl) {
            if (pollError) {
                return NextResponse.json({ error: pollError }, { status: 500 });
            }
            // If polling timed out, return taskId so client can poll or finish asynchronously
            return NextResponse.json({
                success: true,
                status: 'pending',
                taskId,
                message: 'Voiceover is still generating. Task ID returned for status checks.'
            });
        }

        return NextResponse.json({
            success: true,
            status: 'completed',
            taskId,
            audioUrl
        });

    } catch (err: any) {
        console.error("[Grok TTS API Error]:", err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
