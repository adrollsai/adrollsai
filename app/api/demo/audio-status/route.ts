import { NextResponse } from 'next/server';
import { queryKieTask } from '@/utils/external-apis';
import { buildAcousticCues } from '@/utils/demo-creative-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const taskId = searchParams.get('taskId');
        const scriptText = searchParams.get('scriptText') || '';

        if (!taskId) {
            return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
        }

        const statusRes = await queryKieTask(taskId);

        if (statusRes.state === 'success' && statusRes.resultUrl) {
            const audioUrl = statusRes.resultUrl;
            let actualAudioDuration = 22.0;

            // Inspect audio duration from WAV header byte rate (24000Hz 16-bit mono = 48,000 bytes/sec)
            try {
                const headRes = await fetch(audioUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
                const cl = headRes.headers.get('content-length');
                if (cl) {
                    const bytes = parseInt(cl, 10);
                    if (bytes > 44) {
                        actualAudioDuration = Math.max(8.0, Math.min(25.5, (bytes - 44) / 48000));
                    }
                }
            } catch (durErr) {
                console.warn('[Demo Audio Status] Audio duration probe notice:', durErr);
            }

            // Generate duration-aligned acoustic caption cards
            const scriptCues = buildAcousticCues(scriptText, actualAudioDuration);

            return NextResponse.json({
                state: 'success',
                audioUrl,
                scriptCues,
                duration: actualAudioDuration
            });
        }

        if (statusRes.state === 'fail') {
            return NextResponse.json({
                state: 'fail',
                error: statusRes.error || 'TTS Voiceover synthesis failed'
            });
        }

        return NextResponse.json({
            state: 'processing'
        });
    } catch (e: any) {
        return NextResponse.json({
            error: e.message || 'Failed to query audio task status'
        }, { status: 500 });
    }
}

