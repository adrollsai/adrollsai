import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const avatarUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/logos/29937131-1975-4c5f-9b78-e5b28f918d32/1781764543058-avatar-29937131-1975-4c5f-9b78-e5b28f918d32-1781764540575.png";
const userId = "29937131-1975-4c5f-9b78-e5b28f918d32";

async function main() {
    console.log("Original URL:", avatarUrl);
    try {
        // Dynamically import to ensure dotenv is fully initialized before r2 is imported!
        const { ensureJpegImage } = await import('../utils/image-converter');
        const resultUrl = await ensureJpegImage(avatarUrl, userId);
        console.log("Result URL:", resultUrl);
        
        if (resultUrl && resultUrl.startsWith('http')) {
            const headRes = await fetch(resultUrl, { method: 'HEAD' });
            console.log("Result Headers:");
            console.log("  Content-Type:", headRes.headers.get('content-type'));
            console.log("  Content-Length:", headRes.headers.get('content-length'));
        }
    } catch (e) {
        console.error("Conversion failed:", e);
    }
}

main();
