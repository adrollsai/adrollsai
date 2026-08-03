const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ffmpegBinary = path.join(
  process.cwd(), 
  'node_modules/ffmpeg-static', 
  os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);

const audioUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/voiceover/1785750370302_ba8e828189a53400d71364642659ab82.mp3';

async function checkAudio() {
  const res = await fetch(audioUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log("Audio MP3 size:", buf.length, "bytes");
  const tmpAudio = path.join(os.tmpdir(), 'test_voice.mp3');
  fs.writeFileSync(tmpAudio, buf);

  exec(`"${ffmpegBinary}" -i "${tmpAudio}"`, (e, stdout, stderr) => {
    console.log("FFmpeg audio info:\n", stderr);
  });
}

checkAudio();
