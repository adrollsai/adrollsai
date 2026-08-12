const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
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

async function combineGnrNovaNexusVideo() {
  const assetId = '2fefb00a-ed57-43ef-ac6e-72ffdfeae44e';
  console.log(`=== STITCHING VOICEOVER INTO GNR ASSET ${assetId} ===`);

  const { data: asset } = await supabase
    .from('assets')
    .select('*')
    .eq('id', assetId)
    .single();

  if (!asset) {
    console.error("Asset not found!");
    return;
  }

  const videoUrl = asset.url;
  const audioUrl = asset.metadata?.audioUrl;

  console.log("Video URL:", videoUrl);
  console.log("Audio URL:", audioUrl);

  const tmpDir = path.join(os.tmpdir(), `gnr_stitch_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const videoPath = path.join(tmpDir, 'video.mp4');
  const audioPath = path.join(tmpDir, 'audio.mp3');
  const outputPath = path.join(tmpDir, 'final_with_voiceover.mp4');

  console.log("Downloading video...");
  const vRes = await fetch(videoUrl);
  fs.writeFileSync(videoPath, Buffer.from(await vRes.arrayBuffer()));

  console.log("Downloading audio...");
  const aRes = await fetch(audioUrl);
  fs.writeFileSync(audioPath, Buffer.from(await aRes.arrayBuffer()));

  console.log("Combining video and audio using FFmpeg...");
  // Combine video and audio: replace/mix audio with voiceover
  const ffmpegCmd = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`;

  await new Promise((resolve, reject) => {
    exec(ffmpegCmd, (err, stdout, stderr) => {
      if (err) {
        console.error("FFmpeg error:", stderr);
        reject(err);
      } else {
        console.log("FFmpeg completed successfully!");
        resolve();
      }
    });
  });

  const outputBuffer = fs.readFileSync(outputPath);
  const r2Key = `generated/${asset.user_id}/gnr_nova_nexus_voiceover_${Date.now()}.mp4`;

  console.log("Uploading final video with voiceover to Cloudflare R2...");
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME || 'adrolls-storage',
    Key: r2Key,
    Body: outputBuffer,
    ContentType: 'video/mp4'
  }));

  const finalPublicUrl = `${process.env.R2_PUBLIC_URL}/${r2Key}`;
  console.log("New Final Video URL with Voiceover:", finalPublicUrl);

  // Update asset in Supabase
  const { error: updateErr } = await supabase
    .from('assets')
    .update({
      url: finalPublicUrl,
      status: 'Ready',
      metadata: {
        ...asset.metadata,
        voiceoverAttached: true,
        audioUrl
      }
    })
    .eq('id', assetId);

  if (updateErr) {
    console.error("Database update error:", updateErr);
  } else {
    console.log("SUCCESS! GNR Homes Nova Nexus asset updated in database with full voiceover!");
  }
}

combineGnrNovaNexusVideo().catch(console.error);
