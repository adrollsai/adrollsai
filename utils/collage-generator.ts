import { createKieTask, queryKieTask } from './external-apis';
import sharp from 'sharp';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from './r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Creates 9:16 grid collages from product image URLs.
 * Uses GPT 2.0 (gpt-image-2-image-to-image via Kie.ai) to generate a 6-image grid collage in 9:16 aspect ratio.
 * Falls back to Sharp canvas grid stitching if API call fails or times out.
 * 
 * @param imageUrls Input product image URLs
 * @param userId User ID for folder organization
 * @returns Array of 9:16 collage image URLs
 */
export async function createCollageImages(imageUrls: string[], userId: string = 'system'): Promise<string[]> {
    if (!imageUrls || imageUrls.length === 0) {
        return [];
    }

    // Filter valid URLs
    const validUrls = imageUrls.filter(url => 
        url && typeof url === 'string' && url.startsWith('http') && 
        !url.includes('placeholder') && !url.includes('placehold')
    );

    if (validUrls.length === 0) {
        return [];
    }

    // Split into chunks of max 6 images
    const CHUNK_SIZE = 6;
    const chunks: string[][] = [];
    for (let i = 0; i < validUrls.length; i += CHUNK_SIZE) {
        chunks.push(validUrls.slice(i, i + CHUNK_SIZE));
    }

    const collageUrls: string[] = [];

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        console.log(`[Collage Generator] Generating 9:16 collage ${chunkIdx + 1}/${chunks.length} with ${chunk.length} images using GPT 2.0...`);

        let generatedCollageUrl: string | null = null;

        // 1. Try GPT 2.0 (gpt-image-2-image-to-image) via Kie.ai first
        try {
            const collagePrompt = `Reference images locked. Create an ultra-clean, high-converting 9:16 grid collage featuring these ${chunk.length} product images arranged neatly in a modern commercial 6-image grid layout. Professional studio lighting, seamless alignment, clean borders, 9:16 vertical orientation, no text overlays, commercial ad asset.`;
            
            const payload = {
                model: "gpt-image-2-image-to-image",
                input: {
                    prompt: collagePrompt,
                    aspect_ratio: "9:16",
                    resolution: "1K",
                    input_urls: chunk.slice(0, 6)
                }
            };

            const { taskId, error: createError } = await createKieTask(payload);
            if (taskId) {
                console.log(`[Collage Generator] GPT 2.0 task created with ID: ${taskId}. Polling for completion...`);
                // Poll status for up to 60 seconds (12 attempts x 5s)
                let attempts = 0;
                while (attempts < 12) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    const statusRes = await queryKieTask(taskId);
                    if (statusRes.state === 'success' && statusRes.resultUrl) {
                        generatedCollageUrl = statusRes.resultUrl;
                        console.log(`[Collage Generator] GPT 2.0 successfully generated 9:16 collage: ${generatedCollageUrl}`);
                        break;
                    }
                    if (statusRes.state === 'fail') {
                        console.warn(`[Collage Generator] GPT 2.0 task failed: ${statusRes.error}`);
                        break;
                    }
                    attempts++;
                }
            } else {
                console.warn(`[Collage Generator] GPT 2.0 task creation failed: ${createError}`);
            }
        } catch (gptErr) {
            console.error(`[Collage Generator] GPT 2.0 generation error, switching to Sharp fallback:`, gptErr);
        }

        // 2. Fallback to Sharp 9:16 grid compositing if GPT 2.0 did not produce a URL
        if (!generatedCollageUrl) {
            console.log(`[Collage Generator] Using Sharp fallback to assemble 9:16 grid collage for chunk ${chunkIdx + 1}...`);
            generatedCollageUrl = await buildSharpCollageFallback(chunk, chunkIdx, userId);
        }

        if (generatedCollageUrl) {
            collageUrls.push(generatedCollageUrl);
        }
    }

    return collageUrls;
}

/**
 * Fallback Sharp 9:16 grid compositor
 */
async function buildSharpCollageFallback(chunk: string[], chunkIdx: number, userId: string): Promise<string | null> {
    try {
        const bufferPromises = chunk.map(async (url) => {
            try {
                const res = await fetch(url, { headers: { 'User-Agent': 'Nobogent-Collage/1.0' } });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const arrayBuffer = await res.arrayBuffer();
                return Buffer.from(arrayBuffer);
            } catch (err) {
                return null;
            }
        });

        const fetched = await Promise.all(bufferPromises);
        const buffers: Buffer[] = [];
        for (const b of fetched) {
            if (b) buffers.push(b);
        }
        if (buffers.length === 0) return null;

        const canvasWidth = 1080;
        const canvasHeight = 1920;

        let cols = 2;
        let rows = 3;
        if (buffers.length === 1) { cols = 1; rows = 1; }
        else if (buffers.length === 2) { cols = 1; rows = 2; }
        else if (buffers.length === 3) { cols = 1; rows = 3; }
        else if (buffers.length === 4) { cols = 2; rows = 2; }

        const cellWidth = Math.floor(canvasWidth / cols);
        const cellHeight = Math.floor(canvasHeight / rows);

        const compositeOverlays: { input: Buffer; top: number; left: number }[] = [];

        for (let i = 0; i < buffers.length; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const top = row * cellHeight;
            const left = col * cellWidth;

            const resizedBuffer = await sharp(buffers[i])
                .resize(cellWidth, cellHeight, { fit: 'cover', position: 'center' })
                .toBuffer();

            compositeOverlays.push({ input: resizedBuffer, top, left });
        }

        const compositeBuffer = await sharp({
            create: {
                width: canvasWidth,
                height: canvasHeight,
                channels: 3,
                background: { r: 15, g: 23, b: 42 }
            }
        })
        .composite(compositeOverlays)
        .jpeg({ quality: 90 })
        .toBuffer();

        const fileName = `collage_916_${Date.now()}_${chunkIdx + 1}.jpg`;
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && serviceKey) {
            const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/properties/${fileName}`, {
                method: 'POST',
                headers: {
                    'apikey': serviceKey,
                    'Authorization': `Bearer ${serviceKey}`,
                    'Content-Type': 'image/jpeg'
                },
                body: new Uint8Array(compositeBuffer)
            });

            if (uploadRes.ok) {
                const publicCollageUrl = `${supabaseUrl}/storage/v1/object/public/properties/${fileName}`;
                console.log(`[Collage Generator] Uploaded 9:16 collage to Supabase Storage: ${publicCollageUrl}`);
                return publicCollageUrl;
            }
        }

        // Fallback to Cloudflare R2 if Supabase upload fails
        const r2Key = `generated/${userId}/${fileName}`;
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: compositeBuffer,
            ContentType: 'image/jpeg'
        }));

        return `${R2_PUBLIC_URL}/adrolls-storage/${r2Key}`;
    } catch (err) {
        console.error(`[Collage Generator] Sharp fallback failed:`, err);
        return null;
    }
}
