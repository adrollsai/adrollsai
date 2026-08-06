const { createClient } = require('@supabase/supabase-js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const ffmpegBinary = path.join(
  process.cwd(), 
  'node_modules/ffmpeg-static', 
  os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixUserVideo() {
  const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785757278763.mp4';
  
  // Find asset matching this URL or find latest asset for GNR Homes
  const { data: asset } = await supabaseAdmin
    .from('assets')
    .select('*')
    .or(`url.eq.${videoUrl},id.eq.e1f82e62-0117-4699-95b7-f41bfc1ec93d`)
    .single();

  console.log("Asset record found:", asset);

  const audioUrl = asset?.metadata?.audioUrl || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/voiceover/1785750370302_ba8e828189a53400d71364642659ab82.mp3';
  console.log("Using voiceover audio URL:", audioUrl);

  const tempDir = path.join(os.tmpdir(), 'fix_user_video');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const localVid = path.join(tempDir, 'user_video.mp4');
  const localAud = path.join(tempDir, 'voiceover.wav');
  const localOut = path.join(tempDir, 'stitched_with_voiceover_final.mp4');

  console.log("Downloading video...");
  const vRes = await fetch(videoUrl);
  fs.writeFileSync(localVid, Buffer.from(await vRes.arrayBuffer()));

  console.log("Downloading voiceover audio...");
  const aRes = await fetch(audioUrl);
  fs.writeFileSync(localAud, Buffer.from(await aRes.arrayBuffer()));

  const cmd = `"${ffmpegBinary}" -nostdin -y -i "${localVid}" -i "${localAud}" -c:v copy -c:a aac -ar 48000 -ac 2 -shortest -movflags +faststart "${localOut}"`;
  console.log("Executing FFmpeg audio merge:", cmd);

  exec(cmd, async (err, stdout, stderr) => {
    if (err) {
      console.error("FFmpeg error:", err);
      console.error("Stderr:", stderr);
      return;
    }

    console.log("FFmpeg merge successful!");
    
    // Upload to R2
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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

    const r2Key = `generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/fixed_stitched_voiceover_${Date.now()}.mp4`;
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: fs.readFileSync(localOut),
      ContentType: 'video/mp4'
    }));

    const finalR2Url = `${R2_PUBLIC_URL}/${r2Key}`;
    console.log("FINAL FIXED VIDEO URL WITH LOUD STEREO VOICE OVER:", finalR2Url);

    // Update asset in database
    if (asset?.id) {
      await supabaseAdmin.from('assets').update({
        url: finalR2Url,
        status: 'Draft'
      }).eq('id', asset.id);
      console.log("Updated asset record in database:", asset.id);
    }
  });
}

fixUserVideo();
