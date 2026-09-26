import sharp from 'sharp';
import crypto from 'crypto';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from './r2';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Ensures that the given image is in JPEG format.
 * If the image is not a JPEG (e.g. it is a PNG or WebP), it downloads it,
 * converts it using sharp, uploads the resulting JPEG to R2, and returns the R2 URL.
 */
export async function ensureJpegImage(imageUrl: string, userId: string, targetAspectRatio?: string): Promise<string> {
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
        return imageUrl;
    }

    const cleanPath = imageUrl.toLowerCase().split('?')[0];
    const isExplicitJpeg = cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg');
    const is9x16Requested = targetAspectRatio === '9:16';

    // If already JPEG and no specific aspect ratio formatting requested, return immediately
    if (isExplicitJpeg && !is9x16Requested) {
        return imageUrl;
    }

    let hash = crypto.createHash('md5').update(`${imageUrl}_${targetAspectRatio || 'orig'}`).digest('hex');
    const cacheKey = `generated/${userId}/converted_${targetAspectRatio ? targetAspectRatio.replace(':', 'x') + '_' : ''}${hash}.jpg`;
    const cachedUrl = `${R2_PUBLIC_URL}/${cacheKey}`;

    try {
        await r2.send(new HeadObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey
        }));
        console.log(`[Ensure JPEG Cache] Found cached converted image: ${cachedUrl}`);
        return cachedUrl;
    } catch (e) {
        console.log(`[Ensure JPEG Cache] No cache found. Processing image: ${imageUrl} (target ratio: ${targetAspectRatio || 'original'})`);
    }

    try {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`Failed to download image: ${res.statusText}`);

        const inputBuffer = Buffer.from(await res.arrayBuffer());
        let pipeline = sharp(inputBuffer);

        if (is9x16Requested) {
            const meta = await pipeline.metadata();
            const width = meta.width || 720;
            const height = meta.height || 1280;
            const currentRatio = width / height;
            // 9:16 is 0.5625. If ratio deviates noticeably from 9:16 (e.g. square 1.0 or landscape 1.77)
            if (Math.abs(currentRatio - 0.5625) > 0.05) {
                console.log(`[Ensure JPEG] Formatting reference image from ${width}x${height} (${currentRatio.toFixed(2)}) to 9:16 portrait (720x1280) for AI video model...`);
                pipeline = pipeline.resize(720, 1280, {
                    fit: 'cover',
                    position: 'center'
                });
            }
        }
        
        // Convert to jpeg using sharp
        const jpegBuffer = await pipeline
            .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
            .toBuffer();

        // Upload to R2
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey,
            Body: jpegBuffer,
            ContentType: 'image/jpeg'
        }));

        console.log(`[Ensure JPEG] Successfully converted and uploaded: ${cachedUrl}`);
        return cachedUrl;
    } catch (err: any) {
        console.error("[Ensure JPEG Error] Failed to convert image, falling back to original URL:", err);
        return imageUrl;
    }
}
