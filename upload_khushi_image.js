const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT ? process.env.R2_ENDPOINT.replace(/\/adrolls-storage$/, '') : `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'adrolls-storage';
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';

async function upload() {
  const filePath = 'C:/Users/Adrolls/Downloads/khushi sir.png';
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    return;
  }
  const fileBuffer = fs.readFileSync(filePath);
  const key = `campaigns/d838c956-1761-4bce-9d91-32f3abecc222/khushi_commercial_aerocity_${Date.now()}.png`;

  console.log(`Uploading ${fileBuffer.length} bytes to R2 key ${key}...`);
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: 'image/png'
  }));

  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  console.log('SUCCESS! Public R2 URL:', publicUrl);
  return publicUrl;
}

if (require.main === module) {
  upload().catch(console.error);
}

module.exports = { upload };
