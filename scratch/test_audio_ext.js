const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const avatarUrl = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/character-bc63c065-9bcc-4793-bedc-f0960406425b-1780131564353.mp4";
const userId = "test-user";

async function runTest() {
    const tempDir = path.join(os.tmpdir(), `trim_test_${Date.now()}`);
    console.log("Temp Dir:", tempDir);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const inputPath = path.join(tempDir, 'input.mp4');
        const outputPath = path.join(tempDir, 'output.mp4');
        const audioPath = path.join(tempDir, 'output.mp3');
        
        // 1. Download
        console.log("Downloading reference video...");
        const res = await fetch(avatarUrl);
        if (!res.ok) throw new Error(`Failed to download reference video: ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(inputPath, buffer);
        console.log("Download success. Buffer size:", buffer.length);
        
        // 2. FFmpeg Binary path
        const ffmpegBinary = path.join(
            process.cwd(), 
            'node_modules', 
            'ffmpeg-static', 
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        console.log("FFmpeg Binary Path:", ffmpegBinary);
        console.log("FFmpeg exists?", fs.existsSync(ffmpegBinary));

        // 3. Trim Command
        const cmdTrim = `"${ffmpegBinary}" -y -i "${inputPath}" -t 15 -c:v libx264 -c:a aac -preset superfast -movflags +faststart "${outputPath}"`;
        console.log("Running trim command:", cmdTrim);
        await new Promise((resolve, reject) => {
            exec(cmdTrim, (err, stdout, stderr) => {
                if (err) {
                    console.error("Trim Stderr:", stderr);
                    reject(err);
                }
                else resolve();
            });
        });
        console.log("Trim completed successfully!");

        // 4. Audio Extraction Command
        const cmdAudio = `"${ffmpegBinary}" -y -i "${outputPath}" -vn -c:a libmp3lame -q:a 2 "${audioPath}"`;
        console.log("Running audio command:", cmdAudio);
        await new Promise((resolve, reject) => {
            exec(cmdAudio, (err, stdout, stderr) => {
                if (err) {
                    console.error("Audio Stderr:", stderr);
                    reject(err);
                }
                else resolve();
            });
        });
        console.log("Audio extraction completed successfully!");
        console.log("Audio File exists?", fs.existsSync(audioPath));
        if (fs.existsSync(audioPath)) {
            console.log("Audio File Size:", fs.statSync(audioPath).size);
        }
    } catch (err) {
        console.error("Test failed with error:", err);
    } finally {
        // Clean up
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
                console.log("Cleaned up temp directory.");
            }
        } catch (e) {}
    }
}

runTest();
