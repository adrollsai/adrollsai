const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/adrolls-storage\/?$/, '');
const r2 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const USER_ID = 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f';

async function uploadToR2(localPath, key, contentType = 'image/png') {
  const fileBuffer = fs.readFileSync(localPath);
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  );
  return `${R2_PUBLIC_URL}/${key}`;
}

async function main() {
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', USER_ID).single();
  const token = profile.facebook_token;
  const adAccountId = profile.ad_account_id;

  const downloadDir = path.join(process.env.USERPROFILE, 'Downloads', 'Mysore');
  const files = [
    'A Piece of Nature_ Luxury Glamping Retreat.png',
    'Amritha Vana Mysore Farm Retreat.png',
    'Golden Horizon Farm Plots.png'
  ];

  const results = [];

  for (const filename of files) {
    const fullPath = path.join(downloadDir, filename);
    const cleanName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const r2Key = `creatives/${USER_ID}/${Date.now()}-${cleanName}`;
    
    console.log(`Uploading ${filename} to R2...`);
    const r2Url = await uploadToR2(fullPath, r2Key, 'image/png');
    console.log(`✓ R2 URL: ${r2Url}`);

    console.log(`Uploading ${filename} to Meta Ad Account (${adAccountId})...`);
    const fileBuffer = fs.readFileSync(fullPath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });
    const formData = new FormData();
    formData.append('source', blob, cleanName);
    formData.append('access_token', token);

    const imgRes = await fetch(`https://graph.facebook.com/v21.0/${adAccountId}/adimages`, {
      method: 'POST',
      body: formData,
    });
    const imgData = await imgRes.json();
    console.log('Meta Ad Image response:', imgData);

    if (imgData.error || !imgData.images) {
      throw new Error(`Failed to upload ${filename} to Meta: ${imgData.error?.message || JSON.stringify(imgData)}`);
    }

    const firstKey = Object.keys(imgData.images)[0];
    const imageHash = imgData.images[firstKey].hash;
    console.log(`✓ Image Hash for ${filename}:`, imageHash);

    results.push({
      filename,
      r2Url,
      imageHash,
    });
  }

  console.log('\n--- ALL CREATIVES UPLOADED SUCCESSFULLY ---');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
