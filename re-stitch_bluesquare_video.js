const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function fixVideo() {
  const assetId = "f4c6c193-0aa5-4943-88b0-dbcb1fdafb5d";
  console.log(`Fixing asset ${assetId}...`);

  const { data: asset } = await supabaseAdmin.from('assets').select('*').eq('id', assetId).single();
  if (!asset) return console.error("Asset not found!");

  const audioUrl = asset.metadata?.audioUrl?.replace('r2.dev/adrolls-storage/', 'r2.dev/');
  const videoUrl = asset.url;

  console.log("Existing Video URL:", videoUrl);
  console.log("Existing Audio URL:", audioUrl);

  const tempDir = path.join(os.tmpdir(), `fix_${assetId}`);
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const inputVideoPath = path.join(tempDir, 'video.mp4');
  const inputAudioPath = path.join(tempDir, 'audio.mp3');
  const outputPath = path.join(tempDir, 'final_with_voiceover.mp4');

  console.log("Downloading video and audio...");
  const vBuf = Buffer.from(await (await fetch(videoUrl)).arrayBuffer());
  const aBuf = Buffer.from(await (await fetch(audioUrl)).arrayBuffer());

  fs.writeFileSync(inputVideoPath, vBuf);
  fs.writeFileSync(inputAudioPath, aBuf);

  console.log("Mixing voiceover with FFmpeg...");
  const ffmpegCmd = `ffmpeg -nostdin -y -i "${inputVideoPath}" -i "${inputAudioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -ar 48000 -ac 2 -shortest -movflags +faststart "${outputPath}"`;
  execSync(ffmpegCmd, { stdio: 'inherit' });

  console.log("Uploading final video with voiceover to Cloudflare R2...");
  const finalBuffer = fs.readFileSync(outputPath);
  const r2Key = `generated/${asset.user_id}/stitched_voiceover_${Date.now()}.mp4`;

  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME || 'adrolls-storage',
    Key: r2Key,
    Body: finalBuffer,
    ContentType: 'video/mp4'
  }));

  const publicR2Url = `${process.env.R2_PUBLIC_URL}/${r2Key}`;
  console.log("New Video URL with Voiceover:", publicR2Url);

  // Update Supabase DB asset
  await supabaseAdmin.from('assets').update({
    url: publicR2Url,
    status: 'Draft'
  }).eq('id', assetId);

  console.log("✅ Asset f4c6c193 successfully updated with voiceover audio!");
}

fixVideo();
