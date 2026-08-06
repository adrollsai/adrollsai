import sharp from 'sharp';
import crypto from 'crypto';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from './r2';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Ensures that the given image is in JPEG format.
 * If the image is not a JPEG (e.g. it is a PNG or WebP), it downloads it,
 * converts it using sharp, uploads the resulting JPEG to R2, and returns the R2 URL.
 */
export async function ensureJpegImage(imageUrl: string, userId: string): Promise<string> {
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
        return imageUrl;
    }

    let hash = crypto.createHash('md5').update(imageUrl).digest('hex');

    try {
        const headRes = await fetch(imageUrl, { method: 'HEAD' });
        const contentType = headRes.headers.get('content-type') || '';
        const contentLength = headRes.headers.get('content-length') || '';
        const lastModified = headRes.headers.get('last-modified') || '';
        const eTag = headRes.headers.get('etag') || '';

        const lowercaseUrl = imageUrl.toLowerCase();
        const isJpg = lowercaseUrl.includes('.jpg') || lowercaseUrl.includes('.jpeg');
        const isJpegContentType = contentType.toLowerCase().includes('jpeg') || contentType.toLowerCase().includes('jpg');

        if (isJpg && isJpegContentType) {
            console.log(`[Ensure JPEG] Image is already JPEG: ${imageUrl}`);
            return imageUrl;
        }

        // Add details to hash for cache invalidation
        hash = crypto.createHash('md5').update(`${imageUrl}_${contentLength}_${lastModified}_${eTag}`).digest('hex');
    } catch (e) {
        console.warn(`[Ensure JPEG] HEAD request failed, using fallback hash for URL string: ${hash}`);
    }

    const cacheKey = `generated/${userId}/converted_img_${hash}.jpg`;
    const cachedUrl = `${R2_PUBLIC_URL}/${cacheKey}`;

    try {
        await r2.send(new HeadObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey
        }));
        console.log(`[Ensure JPEG Cache] Found cached converted image: ${cachedUrl}`);
        return cachedUrl;
    } catch (e) {
        console.log(`[Ensure JPEG Cache] No cache found. Converting to JPEG: ${imageUrl}`);
    }

    try {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`Failed to download image: ${res.statusText}`);

        const inputBuffer = Buffer.from(await res.arrayBuffer());
        
        // Convert to jpeg using sharp
        const jpegBuffer = await sharp(inputBuffer)
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
