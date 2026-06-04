const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const originalUrl = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/character-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1780561506878.mp4";

const ffmpegBinary = path.join(
    process.cwd(), 
    'node_modules', 
    'ffmpeg-static', 
    os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);

async function testCmd(cmd, label) {
    return new Promise((resolve) => {
        console.log(`\n--- Testing ${label} ---`);
        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                console.log("Result: FAILED");
                console.log("Error:", err.message);
                console.log("Stderr:", stderr);
            } else {
                console.log("Result: SUCCESS!");
            }
            resolve();
        });
    });
}

async function run() {
    const tempDir = path.join(os.tmpdir(), `ffmpeg_trim_test_${Date.now()}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const inputPath = path.join(tempDir, 'input.mp4');
    const out1 = path.join(tempDir, 'out1.mp4');
    
    console.log("Downloading new video...");
    const res = await fetch(originalUrl);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);
    console.log("Downloaded size:", buffer.length);

    console.log("\nProbing input video details:");
    await testCmd(`"${ffmpegBinary}" -i "${inputPath}"`, "Probe original video");

    // Using -t 14 (exact production command)
    const scaleFilter = "scale='trunc(min(iw\\,iw*sqrt(2000000/(iw*ih)))/2)*2':-2";
    const cmd = `"${ffmpegBinary}" -y -i "${inputPath}" -t 14 -vf "${scaleFilter}" -c:v libx264 -c:a aac -preset superfast -movflags +faststart "${out1}"`;
    
    console.log("\nCommand:", cmd);
    await testCmd(cmd, "FFmpeg trim with -t 14 and scaleFilter");

    if (fs.existsSync(out1)) {
        console.log("\nProbing output video details:");
        await testCmd(`"${ffmpegBinary}" -i "${out1}"`, "Probe trimmed video");
    }
    
    // Clean up
    try {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch(e){}
}

run();
