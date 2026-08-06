import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from './r2';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const execPromise = promisify(exec);

export async function generateAndUploadVideoThumbnail(
    localVideoPath: string,
    userId: string,
    assetId: string
): Promise<string | null> {
    const tempDir = os.tmpdir();
    const thumbnailPath = path.join(tempDir, `thumb-${assetId}-${Date.now()}.jpg`);
    let thumbnailCreated = false;

    try {
        const nodeModulesFfmpeg = path.join(
            process.cwd(),
            'node_modules',
            'ffmpeg-static',
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        const ffmpeg = fs.existsSync(nodeModulesFfmpeg) ? nodeModulesFfmpeg : (ffmpegPath || 'ffmpeg');
        
        // Extract 1 frame at 1.0 second and scale it down to a web-optimized 360px width.
        const command = `"${ffmpeg}" -y -ss 00:00:01 -i "${localVideoPath}" -vf "scale=360:-1" -vframes 1 "${thumbnailPath}"`;
        console.log(`[Thumbnail Helper] Extracting thumbnail. Command: ${command}`);
        
        await execPromise(command);
        
        if (fs.existsSync(thumbnailPath)) {
            thumbnailCreated = true;
            const buffer = fs.readFileSync(thumbnailPath);
            const r2Key = `thumbnails/${userId}/${assetId}_${Date.now()}.jpg`;
            
            console.log(`[Thumbnail Helper] Uploading thumbnail to Cloudflare R2 bucket ${R2_BUCKET} at key: ${r2Key}`);
            await r2.send(new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: r2Key,
                Body: buffer,
                ContentType: 'image/jpeg'
            }));
            
            const thumbUrl = `${R2_PUBLIC_URL}/${r2Key}`;
            console.log(`[Thumbnail Helper] Thumbnail upload complete. URL: ${thumbUrl}`);
            return thumbUrl;
        }
    } catch (err) {
        console.error(`[Thumbnail Helper] Failed to generate/upload thumbnail:`, err);
    } finally {
        if (thumbnailCreated && fs.existsSync(thumbnailPath)) {
            try {
                fs.unlinkSync(thumbnailPath);
            } catch (e) {
                console.error(`[Thumbnail Helper] Failed to delete temp thumbnail file:`, e);
            }
        }
    }
    return null;
}
