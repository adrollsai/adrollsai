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
    const tempDir = path.join(os.tmpdir(), `ffmpeg_scale_test_${Date.now()}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const inputPath = path.join(tempDir, 'input.mp4');
    const out1 = path.join(tempDir, 'out1.mp4');
    
    console.log("Downloading video...");
    const res = await fetch(originalUrl);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);
    console.log("Downloaded size:", buffer.length);

    // Test 1: Math filter for scaling
    // We want the total pixels to be <= 2073600 (1920 * 1080)
    // Scale filter expression: scale='min(iw, iw*sqrt(2000000/(iw*ih))):-2'
    // Comma needs to be escaped with a backslash in standard filter syntax, OR we can wrap the whole scale expression in single quotes.
    // In node, command is a string, so we need to be careful with escaping.
    const filter = "scale='trunc(min(iw\\,iw*sqrt(2000000/(iw*ih)))/2)*2':-2";
    const cmd = `"${ffmpegBinary}" -y -i "${inputPath}" -t 5 -vf "${filter}" -c:v libx264 -an -preset superfast "${out1}"`;
    
    console.log("Command:", cmd);
    await testCmd(cmd, "FFmpeg scale filter with math expression");

    if (fs.existsSync(out1)) {
        console.log("Output file generated. Let's probe it.");
        await testCmd(`"${ffmpegBinary}" -i "${out1}"`, "Probe output video");
    }
    
    // Clean up
    try {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch(e){}
}

run();
