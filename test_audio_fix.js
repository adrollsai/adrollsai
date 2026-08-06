const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ffmpegBinary = path.join(
  process.cwd(), 
  'node_modules/ffmpeg-static', 
  os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);

const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785750932922.mp4';
const audioUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/voiceover/1785750370302_ba8e828189a53400d71364642659ab82.mp3';

async function fixAudioMerge() {
  const tempDir = path.join(os.tmpdir(), 'test_audio_fix');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const localVideo = path.join(tempDir, 'video.mp4');
  const localAudio = path.join(tempDir, 'voice.wav');
  const localOutput = path.join(tempDir, 'fixed_voiceover.mp4');

  console.log("Downloading video...");
  const vRes = await fetch(videoUrl);
  fs.writeFileSync(localVideo, Buffer.from(await vRes.arrayBuffer()));

  console.log("Downloading audio...");
  const aRes = await fetch(audioUrl);
  fs.writeFileSync(localAudio, Buffer.from(await aRes.arrayBuffer()));

  // Proper FFmpeg command with explicit audio resampling & channel upmixing
  const cmd = `"${ffmpegBinary}" -nostdin -y -i "${localVideo}" -i "${localAudio}" -c:v copy -c:a aac -ar 48000 -ac 2 -shortest -movflags +faststart "${localOutput}"`;
  console.log("Running FFmpeg:", cmd);

  exec(cmd, async (err, stdout, stderr) => {
    if (err) {
      console.error("FFmpeg error:", err);
      console.error("FFmpeg stderr:", stderr);
    } else {
      console.log("SUCCESS! Video with fixed voiceover generated locally:", localOutput);
      console.log("Output size:", fs.statSync(localOutput).size, "bytes");

      // Upload to R2 to test
      const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
      const dotenv = require('dotenv');
      dotenv.config({ path: path.join(__dirname, '.env.local') });

      const r2 = new S3Client({
        region: 'auto',
        endpoint: process.env.R2_ENDPOINT ? process.env.R2_ENDPOINT.replace(/\/adrolls-storage$/, '') : `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
        }
      });
      const R2_BUCKET = process.env.R2_BUCKET_NAME || 'adrolls-storage';
      const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';

      const key = `generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/voiceover_fixed_${Date.now()}.mp4`;
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: fs.readFileSync(localOutput),
        ContentType: 'video/mp4'
      }));

      const fixedUrl = `${R2_PUBLIC_URL}/${key}`;
      console.log("R2 Fixed Video URL:", fixedUrl);

      // Update asset record in Supabase so user can see it in dashboard
      const { createClient } = require('@supabase/supabase-js');
      const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      await supabaseAdmin.from('assets').update({ url: fixedUrl, status: 'Draft' }).eq('id', 'e1f82e62-0117-4699-95b7-f41bfc1ec93d');
      console.log("Updated asset record in Supabase!");
    }
  });
}

fixAudioMerge();
