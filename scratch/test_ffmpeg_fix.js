const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const originalUrl = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/character-bc63c065-9bcc-4793-bedc-f0960406425b-1780133072249.mp4";

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
                console.log("Stderr Snippet:", stderr.split('\n').slice(-5).join('\n'));
            } else {
                console.log("Result: SUCCESS!");
            }
            resolve();
        });
    });
}

async function run() {
    const tempDir = path.join(os.tmpdir(), `ffmpeg_test_${Date.now()}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const inputPath = path.join(tempDir, 'input.mp4');
    const out1 = path.join(tempDir, 'out1.mp4');
    const out2 = path.join(tempDir, 'out2.mp4');
    const out3 = path.join(tempDir, 'out3.mp4');
    const out4 = path.join(tempDir, 'out4.mp3');
    
    console.log("Downloading new avatar video...");
    const res = await fetch(originalUrl);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);
    console.log("Downloaded size:", buffer.length);

    // Test 1: Standard remux with timestamp generation
    await testCmd(
        `"${ffmpegBinary}" -y -fflags +genpts -i "${inputPath}" -t 15 -c:v libx264 -c:a aac -preset superfast "${out1}"`,
        "1. +genpts and aac transcode"
    );

    // Test 2: analyzeduration and probesize
    await testCmd(
        `"${ffmpegBinary}" -y -analyzeduration 100M -probesize 100M -i "${inputPath}" -t 15 -c:v libx264 -c:a aac -preset superfast "${out2}"`,
        "2. analyzeduration & probesize"
    );

    // Test 3: Audio transcode using libopus decoder (forcing format parameters)
    await testCmd(
        `"${ffmpegBinary}" -y -i "${inputPath}" -t 15 -c:v libx264 -c:a libopus -preset superfast "${out3}"`,
        "3. Copying audio stream or re-encoding to libopus"
    );

    // Test 4: Extrct audio directly to MP3 with probesize
    await testCmd(
        `"${ffmpegBinary}" -y -analyzeduration 100M -probesize 100M -i "${inputPath}" -vn -c:a libmp3lame -q:a 2 "${out4}"`,
        "4. Direct MP3 extraction with probesize"
    );

    // Let's probe the durations of out1 and out2 if they succeeded
    if (fs.existsSync(out1)) {
        await testCmd(`"${ffmpegBinary}" -i "${out1}"`, "Probe of out1");
    }
    
    // Clean up
    try {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch(e){}
}

run();
