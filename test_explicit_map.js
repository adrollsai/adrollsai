const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ffmpegBinary = path.join(
  process.cwd(), 
  'node_modules/ffmpeg-static', 
  os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);

const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785757278763.mp4';
const audioUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/voiceover/1785750370302_ba8e828189a53400d71364642659ab82.mp3';

async function testExplicitMapFix() {
  const tempDir = path.join(os.tmpdir(), 'explicit_map_test');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const localVid = path.join(tempDir, 'vid.mp4');
  const localAud = path.join(tempDir, 'aud.wav');
  const localOut = path.join(tempDir, 'explicit_map_out.mp4');

  console.log("Downloading video...");
  const vRes = await fetch(videoUrl);
  fs.writeFileSync(localVid, Buffer.from(await vRes.arrayBuffer()));

  console.log("Downloading audio...");
  const aRes = await fetch(audioUrl);
  fs.writeFileSync(localAud, Buffer.from(await aRes.arrayBuffer()));

  // EXPLICIT MAP: -map 0:v:0 (video from input 0) -map 1:a:0 (audio from input 1)
  const cmd = `"${ffmpegBinary}" -nostdin -y -i "${localVid}" -i "${localAud}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -ar 48000 -ac 2 -shortest -movflags +faststart "${localOut}"`;
  console.log("Running explicit map command:", cmd);

  exec(cmd, async (err, stdout, stderr) => {
    if (err) {
      console.error("FFmpeg error:", err);
      console.error("Stderr:", stderr);
      return;
    }

    console.log("FFmpeg explicit map succeeded!");

    // Upload to R2
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

    const r2Key = `generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/explicit_mapped_voiceover_${Date.now()}.mp4`;
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: fs.readFileSync(localOut),
      ContentType: 'video/mp4'
    }));

    const finalR2Url = `${R2_PUBLIC_URL}/${r2Key}`;
    console.log("EXPLICIT MAPPED VIDEO URL:", finalR2Url);

    // Update asset in database for GNR Homes
    const { createClient } = require('@supabase/supabase-js');
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    await supabaseAdmin.from('assets').update({
      url: finalR2Url,
      status: 'Draft'
    }).eq('id', 'e1f82e62-0117-4699-95b7-f41bfc1ec93d');

    console.log("Updated asset record in database with explicit mapped URL!");
  });
}

testExplicitMapFix();
