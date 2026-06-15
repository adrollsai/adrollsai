const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const assetsToUpload = [
  {
    localName: 'media__1781423840045.png',
    key: 'reference-creatives/premium_seed_orchid.png',
    category: 'premium'
  },
  {
    localName: 'media__1781423659181.jpg',
    key: 'reference-creatives/edm_seed_farmland.jpg',
    category: 'edm'
  },
  {
    localName: 'media__1781423762095.jpg',
    key: 'reference-creatives/high_converting_seed_99acres.jpg',
    category: 'high_converting'
  }
];

async function run() {
  console.log("Starting upload of local seed assets to R2...");
  const results = {};

  for (const asset of assetsToUpload) {
    const localPath = path.join(__dirname, '../.tempmediaStorage', asset.localName);
    const backupPath = path.join(__dirname, '..', asset.localName);
    
    let finalPath = '';
    if (fs.existsSync(localPath)) {
      finalPath = localPath;
    } else if (fs.existsSync(backupPath)) {
      finalPath = backupPath;
    } else {
      // Let's search inside the brain directory
      const brainPath = path.join('C:/Users/USER/.gemini/antigravity-ide/brain/1785c7c1-49aa-4394-8067-388a7906888d', asset.localName);
      if (fs.existsSync(brainPath)) {
        finalPath = brainPath;
      } else {
        console.error(`❌ Local file not found: ${asset.localName}`);
        continue;
      }
    }

    console.log(`Uploading ${finalPath} to R2 key: ${asset.key}...`);
    const fileBuffer = fs.readFileSync(finalPath);
    const mimeType = asset.localName.endsWith('.png') ? 'image/png' : 'image/jpeg';

    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: asset.key,
      Body: fileBuffer,
      ContentType: mimeType
    }));

    const publicUrl = `${R2_PUBLIC_URL}/${asset.key}`;
    console.log(`✅ Uploaded! Public URL: ${publicUrl}`);
    results[asset.category] = publicUrl;
  }

  console.log("Summary of seed URLs:", JSON.stringify(results, null, 2));
}

run().catch(console.error);
