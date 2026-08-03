const { exec } = require('child_process');
const path = require('path');
const os = require('os');

const ffmpegBinary = path.join(
  process.cwd(), 
  'node_modules/ffmpeg-static', 
  os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);

const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785757278763.mp4';

console.log("Probing streams for:", videoUrl);

exec(`"${ffmpegBinary}" -i "${videoUrl}"`, (err, stdout, stderr) => {
  console.log("FFmpeg Output:\n", stderr);
});
