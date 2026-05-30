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

function runProbe(url, label) {
    return new Promise((resolve) => {
        const cmd = `"${ffmpegBinary}" -i "${url}"`;
        exec(cmd, (err, stdout, stderr) => {
            console.log(`\n================== ${label} ==================`);
            console.log(stderr);
            resolve();
        });
    });
}

async function run() {
    await runProbe(originalUrl, "New Supabase Video");
}

run();
