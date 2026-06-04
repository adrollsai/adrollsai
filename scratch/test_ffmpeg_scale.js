const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const mp3Url = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/voice-sample-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1780556476936.mp3";

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
            } else {
                console.log("Result: SUCCESS!");
            }
            resolve();
        });
    });
}

async function run() {
    const tempDir = path.join(os.tmpdir(), `mp3_probe_test_${Date.now()}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const inputPath = path.join(tempDir, 'input.mp3');
    
    console.log("Downloading MP3...");
    const res = await fetch(mp3Url);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);
    console.log("Downloaded size:", buffer.length);

    await testCmd(`"${ffmpegBinary}" -i "${inputPath}"`, "Probe MP3 duration");
    
    // Clean up
    try {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch(e){}
}

run();
