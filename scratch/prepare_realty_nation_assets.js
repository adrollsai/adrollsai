const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT.replace('/' + R2_BUCKET, ''),
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const userId = "c890a11f-84ce-4592-ab8f-8682927b1a9d"; // Realty Nation
const sourceVideoUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/library/c890a11f-84ce-4592-ab8f-8682927b1a9d/1781854790292-videoad.mp4";

async function run() {
    console.log("=== Processing Realty Nation Presenter Video ===");
    
    const tempDir = path.join(os.tmpdir(), `realty_nation_prep_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    const inputPath = path.join(tempDir, 'input.mp4');
    const trimmedPath = path.join(tempDir, 'trimmed.mp4');
    const audioPath = path.join(tempDir, 'audio.mp3');
    
    try {
        // 1. Download source video
        console.log("Downloading source video...");
        const res = await fetch(sourceVideoUrl);
        if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(inputPath, buffer);
        console.log("Downloaded successfully.");
        
        // Find ffmpeg binary
        const ffmpegBinary = path.join(
            process.cwd(), 
            'node_modules', 
            'ffmpeg-static', 
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        
        // 2. Trim video to 14 seconds and scale down to max width 1080p
        console.log("Trimming video to 14s and scaling...");
        const scaleFilter = "scale='trunc(min(iw\\,iw*sqrt(2000000/(iw*ih)))/2)*2':-2";
        const trimCmd = `"${ffmpegBinary}" -y -i "${inputPath}" -t 14 -vf "${scaleFilter}" -c:v libx264 -c:a aac -preset superfast -movflags +faststart "${trimmedPath}"`;
        
        await new Promise((resolve, reject) => {
            exec(trimCmd, (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log("Trimmed video generated.");
        
        // 3. Extract audio from first 14 seconds for voice cloning
        console.log("Extracting audio...");
        const audioCmd = `"${ffmpegBinary}" -y -i "${inputPath}" -t 14 -vn -c:a libmp3lame -q:a 2 "${audioPath}"`;
        await new Promise((resolve, reject) => {
            exec(audioCmd, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log("Audio extracted.");
        
        // 4. Upload trimmed video to R2
        console.log("Uploading trimmed video to R2...");
        const trimmedBuffer = fs.readFileSync(trimmedPath);
        const trimmedKey = `adrolls-storage/generated/${userId}/trimmed_videoad_ref.mp4`;
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: trimmedKey,
            Body: trimmedBuffer,
            ContentType: 'video/mp4'
        }));
        const trimmedUrl = `${process.env.R2_PUBLIC_URL}/${trimmedKey}`;
        console.log(`Trimmed Video URL: ${trimmedUrl}`);
        
        // 5. Upload audio to R2
        console.log("Uploading audio to R2...");
        const audioBuffer = fs.readFileSync(audioPath);
        const audioKey = `adrolls-storage/generated/${userId}/audio_videoad_ref.mp3`;
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: audioKey,
            Body: audioBuffer,
            ContentType: 'audio/mpeg'
        }));
        const audioUrl = `${process.env.R2_PUBLIC_URL}/${audioKey}`;
        console.log(`Audio URL: ${audioUrl}`);
        
        console.log("=== Preparation Complete ===");
        
    } catch (e) {
        console.error("Error during preparation:", e);
    } finally {
        // Cleanup temp folder
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (err) {}
    }
}

run();
