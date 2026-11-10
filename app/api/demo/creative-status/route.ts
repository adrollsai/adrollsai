import { NextResponse } from 'next/server';
import { queryKieTask } from '@/utils/external-apis';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const taskId = searchParams.get('taskId');
        if (!taskId) {
            return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
        }

        const statusRes = await queryKieTask(taskId);

        if (statusRes.state === 'success' && statusRes.resultUrl) {
            let finalUrl = statusRes.resultUrl;

            // Attempt to persist the creative to Cloudflare R2 for high availability & caching
            try {
                const imgRes = await fetch(statusRes.resultUrl, { signal: AbortSignal.timeout(4000) });
                if (imgRes.ok) {
                    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                    const r2Key = `demo-creatives/ai_creative_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
                    await r2.send(new PutObjectCommand({
                        Bucket: R2_BUCKET,
                        Key: r2Key,
                        Body: imgBuf,
                        ContentType: 'image/png'
                    }));
                    finalUrl = `${R2_PUBLIC_URL}/${r2Key}`;
                    console.log(`[Demo Creative Status] Persisted to R2: ${finalUrl}`);
                }
            } catch (r2Err: any) {
                console.warn('[Demo Creative Status] R2 upload notice, serving direct result URL:', r2Err.message);
            }

            return NextResponse.json({
                state: 'success',
                imageUrl: finalUrl
            });
        }

        if (statusRes.state === 'fail') {
            return NextResponse.json({
                state: 'fail',
                error: statusRes.error || 'AI Creative generation failed'
            });
        }

        return NextResponse.json({
            state: 'processing'
        });
    } catch (e: any) {
        return NextResponse.json({
            error: e.message || 'Failed to query creative task status'
        }, { status: 500 });
    }
}

