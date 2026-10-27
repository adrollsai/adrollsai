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

const USER_ID = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde'; // Umang Associates
const AD_ACCOUNT_ID = 'act_724104820352896'; // Editvo account where Rohini Sector 24 runs

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

async function uploadCreative() {
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', USER_ID).single();
  const token = profile.facebook_token;

  const localFile = path.join(process.env.USERPROFILE, 'Downloads', 'umang residencies', 'Umang Residency_ Sector 24 Rohini.png');
  console.log('Uploading creative from:', localFile);

  const cleanName = 'Umang_Residency_Sector_24_Rohini.png';
  const r2Key = `creatives/${USER_ID}/${Date.now()}-${cleanName}`;

  console.log('1. Uploading to R2...');
  const r2Url = await uploadToR2(localFile, r2Key, 'image/png');
  console.log('✓ R2 URL:', r2Url);

  console.log('2. Uploading to Meta Ad Account:', AD_ACCOUNT_ID);
  const fileBuffer = fs.readFileSync(localFile);
  const blob = new Blob([fileBuffer], { type: 'image/png' });
  const formData = new FormData();
  formData.append('source', blob, cleanName);
  formData.append('access_token', token);

  const imgRes = await fetch(`https://graph.facebook.com/v21.0/${AD_ACCOUNT_ID}/adimages`, {
    method: 'POST',
    body: formData,
  });
  const imgData = await imgRes.json();
  console.log('Meta Ad Image response:', imgData);

  const firstKey = Object.keys(imgData.images)[0];
  const imageHash = imgData.images[firstKey].hash;
  console.log('✓ Meta Image Hash:', imageHash);

  return { r2Url, imageHash };
}

uploadCreative().catch(console.error);
