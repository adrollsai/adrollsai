const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const key = env.KIE_API_KEY;

const ffmpegBinary = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobeBin = ffmpegBinary.replace(/ffmpeg(\.exe)?$/, (_, ext) => `ffprobe${ext || ''}`);
const ffprobeExec = fs.existsSync(ffprobeBin) ? `"${ffprobeBin}"` : 'ffprobe';

const taskIds = {
    "resolution=720p (no duration)": "4f59c9f5642e06da7eee042cb928f473",
    "duration:15 in input (re-test)": "930c5c30ea02bd1d9e78ea786fe14374",
    "resolution=720p + duration:15": "5ded4b26f4d6a1edbf50af4bf2e31b7a",
    // Also check remaining from previous batch
    "video_length:15 in input": "22eca5816e31d39ba3c2b1a1d40ccd22",
    "seconds:15 in input": "16c0f0b9d2238641fc43660963216ae0",
};

function probeDuration(url) {
    return new Promise((resolve) => {
        exec(
            `${ffprobeExec} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`,
            (err, stdout) => {
                resolve(err ? null : parseFloat(stdout.trim()).toFixed(2));
            }
        );
    });
}

async function checkAll() {
    for (const [label, taskId] of Object.entries(taskIds)) {
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            headers: { 'Authorization': 'Bearer ' + key }
        });
        const json = await res.json();
        const state = json.data?.state;
        let url = null;
        try { url = JSON.parse(json.data?.resultJson).resultUrls?.[0]; } catch(e) {}
        
        if (state === 'success' && url) {
            const dur = await probeDuration(url);
            console.log(`[${label}] state=success | DURATION=${dur}s`);
        } else {
            console.log(`[${label}] state=${state}`);
        }
    }
}

checkAll().catch(console.error);
