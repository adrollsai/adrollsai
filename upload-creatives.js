const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: '.env.local' });

const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/adrolls-storage\/?$/, '');
const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').replace(/^["']|["']$/g, '').trim();
const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').replace(/^["']|["']$/g, '').trim();
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'adrolls-storage';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev').replace(/\/$/, '');

const r2 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey }
});

async function uploadFile(filePath, contentType) {
  const fileName = path.basename(filePath);
  const key = 'campaigns/procolor/' + Date.now() + '_' + fileName;
  const buffer = fs.readFileSync(filePath);
  console.log('Uploading', fileName, buffer.length, 'bytes to', key);
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
  const publicUrl = R2_PUBLIC_URL + '/' + key;
  console.log('Uploaded successfully:', publicUrl);
  return publicUrl;
}

async function run() {
  try {
    const img1 = 'C:/Users/Adrolls/Desktop/Nobo Native App/procolor-ad/generated/creatives/final-dec/dr1-1x1-dec.png';
    const img2 = 'C:/Users/Adrolls/Desktop/Nobo Native App/procolor-ad/generated/creatives/final-dec/dr3-1x1-dec.png';
    const vid = 'C:/Users/Adrolls/Desktop/Nobo Native App/procolor-ad/renders/procolor-cinematography-dec-master.mp4';

    const vidUrl = await uploadFile(vid, 'video/mp4');
    const img1Url = await uploadFile(img1, 'image/png');
    const img2Url = await uploadFile(img2, 'image/png');

    console.log('ALL_DONE');
    console.log(JSON.stringify({ vidUrl, img1Url, img2Url }, null, 2));
    fs.writeFileSync('uploaded-creatives.json', JSON.stringify({ vidUrl, img1Url, img2Url }, null, 2));
  } catch (e) {
    console.error('Upload error:', e);
  }
}
run();

