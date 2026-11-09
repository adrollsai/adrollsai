const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

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

async function uploadImage() {
  const localPath = 'C:/Users/Adrolls/.gemini/antigravity/brain/70631b73-661a-48ff-ab48-baf6a5e9a516/.user_uploaded/media_1793442830849_256f35b6.jpg';
  const fileBuffer = fs.readFileSync(localPath);
  const key = `user_assets/bc63c065-9bcc-4793-bedc-f0960406425b/halloween_offer_${Date.now()}.jpg`;

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: 'image/jpeg',
    })
  );

  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  console.log('Successfully uploaded image to R2:', publicUrl);
  return publicUrl;
}

uploadImage().catch(console.error);

