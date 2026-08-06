import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createGeminiTTS, queryKieTask } from '@/utils/external-apis';

export async function POST(request: Request) {
    try {
        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');

        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if ((authError || !user) && !impersonateId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            dialogueText,
            speakerName = "Zephyr",
            style = "",
            scene = "A quiet technology studio with a clean and professional atmosphere.",
            sampleContext = "High converting promo voiceover"
        } = body;

        if (!dialogueText || typeof dialogueText !== 'string' || dialogueText.trim().length === 0) {
            return NextResponse.json({ error: 'Dialogue text is required for voiceover generation.' }, { status: 400 });
        }

        console.log(`[Grok TTS API] Creating Gemini 3.1 Flash TTS task for text length ${dialogueText.length}...`);

        const { taskId, error: createError } = await createGeminiTTS({
            dialogueText: dialogueText.trim(),
            speakerName,
            style,
            scene,
            sampleContext
        });

        if (createError || !taskId) {
            return NextResponse.json({ error: createError || 'Failed to create TTS voiceover task.' }, { status: 500 });
        }

        console.log(`[Grok TTS API] Task created successfully with ID ${taskId}. Polling for completion...`);

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
                        const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
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
