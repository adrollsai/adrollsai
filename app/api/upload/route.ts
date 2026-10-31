import { NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const folder = (formData.get('folder') as string) || 'demo-uploads';

        if (!file) {
            return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        let buffer = Buffer.from(bytes);
        let contentType = file.type || 'image/jpeg';
        let ext = file.name.split('.').pop() || 'jpg';

        // If image, optimize and resize to max 1920x1920 to keep upload fast & lightweight
        if (file.type.startsWith('image/') || ext.match(/jpe?g|png|webp|avif/i)) {
            try {
                buffer = await sharp(buffer)
                    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 88, progressive: true })
                    .toBuffer();
                contentType = 'image/jpeg';
                ext = 'jpg';
            } catch (sharpErr) {
                console.warn('[Upload API] Sharp optimization warning, using raw buffer:', sharpErr);
            }
        }

        const fileName = `${Date.now()}_${Math.random().toString(36).substring(6)}.${ext}`;
        const r2Key = `${folder}/${fileName}`;

        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: buffer,
            ContentType: contentType
        }));

        const publicUrl = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${r2Key}`;
        console.log(`[Upload API] Successfully uploaded to R2: ${publicUrl} (${(buffer.length / 1024).toFixed(1)} KB)`);

        return NextResponse.json({
            success: true,
            url: publicUrl,
            size: buffer.length
        });

    } catch (err: any) {
        console.error('[Upload API] Upload error:', err);
        return NextResponse.json({ error: err.message || 'Failed to upload file' }, { status: 500 });
    }
}

