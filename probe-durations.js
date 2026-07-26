const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ffmpegBinary = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobeBin = ffmpegBinary.replace(/ffmpeg(\.exe)?$/, (_, ext) => `ffprobe${ext || ''}`);
const ffprobeExec = fs.existsSync(ffprobeBin) ? `"${ffprobeBin}"` : 'ffprobe';

const clips = {
    "duration:15 TOP LEVEL": "https://tempfile.aiquickdraw.com/ggg/users/d39eec03-c507-4bbd-a22e-6dcbe251bf4b/generated/2aafc007-1940-4211-9aaa-bc08c6797642/generated_video.mp4",
    "length:15 in input": "https://tempfile.aiquickdraw.com/ggg/users/215070fa-19d8-43f0-bbe6-4df9b71c9a69/generated/99f207a5-89cb-482b-9dfb-acebb356098f/generated_video.mp4",
    "clip_length:15 in input": "https://tempfile.aiquickdraw.com/ggg/users/2efdb36e-88d9-4994-875e-9a6dbad13e46/generated/7863910a-3ca7-4933-a86a-5d4642409d89/generated_video.mp4",
    "output_duration:15 in input": "https://tempfile.aiquickdraw.com/ggg/users/64bd18f7-d08a-461c-ac39-3e104b962a21/generated/152640fb-871d-4501-bc06-5fb0529fc732/generated_video.mp4",
    // Also check the 15s clip the user showed us
    "USER_EXAMPLE_15S": "https://tempfile.aiquickdraw.com/ggg/users/841a5ae8-0f5d-47ad-8de9-61a0bd1efa4a/generated/4d485639-b9bd-4c73-b2c3-5a0db6e22d5e/generated_video.mp4"
};

async function probeDuration(label, url) {
    return new Promise((resolve) => {
        exec(
            `${ffprobeExec} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`,
            (err, stdout) => {
                if (err) {
                    console.log(`[${label}] PROBE ERROR: ${err.message.substring(0, 100)}`);
                } else {
                    console.log(`[${label}] DURATION = ${parseFloat(stdout.trim()).toFixed(2)}s`);
                }
                resolve();
            }
        );
    });
}

async function main() {
    console.log("Probing actual video durations...\n");
    for (const [label, url] of Object.entries(clips)) {
        await probeDuration(label, url);
    }
}
main();
