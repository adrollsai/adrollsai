const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function runStitchWithAudio() {
  const assetId = 'e1f82e62-0117-4699-95b7-f41bfc1ec93d';
  const userId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
  const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785750932922.mp4';
  const audioUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/voiceover/1785750370302_ba8e828189a53400d71364642659ab82.mp3';

  console.log("=== Merging Video & Generated Voiceover ===");
  console.log("Video URL:", videoUrl);
  console.log("Audio URL:", audioUrl);

  const tempDir = path.join(os.tmpdir(), `merge_audio_${assetId}`);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const localVideoPath = path.join(tempDir, 'video.mp4');
  const localAudioPath = path.join(tempDir, 'audio.mp3');
  const outputPath = path.join(tempDir, 'final_with_audio.mp4');

  console.log("Downloading video...");
  const vRes = await fetch(videoUrl);
  fs.writeFileSync(localVideoPath, Buffer.from(await vRes.arrayBuffer()));

  console.log("Downloading voiceover audio...");
  const aRes = await fetch(audioUrl);
  fs.writeFileSync(localAudioPath, Buffer.from(await aRes.arrayBuffer()));

  const ffmpegBinary = path.join(
    process.cwd(), 
    'node_modules/ffmpeg-static', 
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  );

  const cmd = `"${ffmpegBinary}" -nostdin -y -i "${localVideoPath}" -i "${localAudioPath}" -c:v copy -c:a aac -shortest -movflags +faststart "${outputPath}"`;
  console.log("Executing FFmpeg audio merge command:", cmd);

  await new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("FFmpeg error:", err);
        console.error("FFmpeg stderr:", stderr);
        reject(err);
      } else {
        console.log("FFmpeg audio merge successful!");
        resolve();
      }
    });
  });

  console.log("Uploading merged video with voiceover to R2...");
  const mergedBuffer = fs.readFileSync(outputPath);
  const finalR2Key = `generated/${userId}/stitched_with_voiceover_${Date.now()}.mp4`;

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: finalR2Key,
    Body: mergedBuffer,
    ContentType: 'video/mp4'
  }));

  const finalPublicUrl = `${R2_PUBLIC_URL}/${finalR2Key}`;
  console.log("SUCCESS! Final Stitched Video with Voiceover URL:", finalPublicUrl);

  console.log("Updating Supabase asset record...");
  const { error } = await supabaseAdmin
    .from('assets')
    .update({
      url: finalPublicUrl,
      status: 'Draft',
      metadata: { audioUrl: audioUrl }
    })
    .eq('id', assetId);

  if (error) {
    console.error("Failed to update Supabase asset:", error);
  } else {
    console.log("Supabase asset updated successfully!");
  }
}

runStitchWithAudio();
