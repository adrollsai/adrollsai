const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
  }
});

async function convertAndSendMP4() {
  const movUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785759781042-7f4f60c4-5a71-405f-8630-4f6249a5564d.mov';
  const movPath = path.join(__dirname, 'temp_input.mov');
  const mp4Path = path.join(__dirname, 'temp_output.mp4');

  // 1. Download .mov file
  console.log("1. Downloading .mov video file...");
  const res = await fetch(movUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(movPath, buffer);
  console.log(`Downloaded MOV size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

  // 2. Convert to MP4 with H.264 / AAC
  console.log("\n2. Converting MOV to MP4 via ffmpeg...");
  const cmd = `ffmpeg -y -i "${movPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${mp4Path}"`;
  execSync(cmd, { stdio: 'inherit' });

  const mp4Buffer = fs.readFileSync(mp4Path);
  console.log(`Converted MP4 size: ${(mp4Buffer.length / 1024 / 1024).toFixed(2)} MB`);

  // 3. Upload converted MP4 to R2
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com
  const r2Key = `library/${userId}/nobogent_demo_video_${Date.now()}.mp4`;

  console.log(`\n3. Uploading converted MP4 to R2 Key: ${r2Key}...`);
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME || 'nobogent-storage',
    Key: r2Key,
    Body: mp4Buffer,
    ContentType: 'video/mp4'
  }));

  const publicMp4Url = `https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/${r2Key}`;
  console.log(`🎉 Public MP4 Video URL: ${publicMp4Url}`);

  // Clean up local temp files
  try { fs.unlinkSync(movPath); fs.unlinkSync(mp4Path); } catch (e) {}

  // 4. Send Meta WhatsApp Interactive Video Header Message to test number 918288835235
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id;
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  const testPhone = '918288835235';

  const bodyText = `Hi Rahul,\n\nWhat if every new lead received an instant follow-up—even while you're busy?\n\nThis short video shows how real estate businesses are using AI to automatically call, message, and nurture leads 24/7.\n\nClick on "Connect with Expert" button below to book a demo!`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: testPhone,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: {
        type: 'video',
        video: {
          link: publicMp4Url
        }
      },
      body: {
        text: bodyText
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'connect_expert',
              title: 'Connect with Expert'
            }
          }
        ]
      }
    }
  };

  console.log(`\n4. Sending native MP4 Video Header + Connect with Expert button to ${testPhone}...`);
  const sendRes = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const sendData = await sendRes.json();
  console.log(`Meta API Status: ${sendRes.status}`);
  console.log("Meta API Response:\n", JSON.stringify(sendData, null, 2));
}

convertAndSendMP4();
