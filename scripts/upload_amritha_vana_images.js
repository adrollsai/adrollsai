const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

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

const sourceDir = path.join(__dirname, '..', 'public', 'amritha-vana');
const publicDir = path.join(__dirname, '..', 'public', 'amritha-vana');

const imageMappings = [
  {
    src: 'WhatsApp Image 2026-10-18 at 19.57.50.jpeg',
    dest: 'hero-dome-sunrise-lake.jpg',
    title: 'Sunrise Geodesic Dome Lake View',
    category: 'hero'
  },
  {
    src: 'WhatsApp Image 2026-10-18 at 19.57.50 (1).jpeg',
    dest: 'dome-poolside-orchard.jpg',
    title: 'Private Pool & Orchard Retreat',
    category: 'resort'
  },
  {
    src: 'WhatsApp Image 2026-10-18 at 19.57.51.jpeg',
    dest: 'dome-evening-pool-pergola.jpg',
    title: 'Twilight Pool & Floral Pergola Lounge',
    category: 'resort'
  },
  {
    src: 'WhatsApp Image 2026-10-18 at 19.57.47.jpeg',
    dest: 'dome-canopy-treehouse.jpg',
    title: 'Canopy Treetop Geodesic Sanctuary',
    category: 'nature'
  },
  {
    src: 'WhatsApp Image 2026-10-18 at 19.57.50 (2).jpeg',
    dest: 'dome-timber-deck-exterior.jpg',
    title: 'Circular Timber Deck & Ambient Gardens',
    category: 'architecture'
  },
  {
    src: 'WhatsApp Image 2026-10-18 at 19.57.51 (1).jpeg',
    dest: 'dome-interior-branding.jpg',
    title: 'Amritha Vana Branded Master Suite & Loft',
    category: 'interior'
  },
  {
    src: 'WhatsApp Image 2026-10-18 at 19.57.52.jpeg',
    dest: 'dome-interior-living-lounge.jpg',
    title: 'Designer Glamping Lounge & Forest Panorama',
    category: 'interior'
  },
  {
    src: 'WhatsApp Image 2026-10-18 at 19.57.51 (2).jpeg',
    dest: 'dome-technical-specs.jpg',
    title: 'Model Mushroom Engineering Specifications',
    category: 'specs'
  },
  {
    src: 'WhatsApp Image 2026-10-18 at 19.57.52 (1).jpeg',
    dest: 'onsite-construction-pathway.jpg',
    title: 'Authentic On-Site Natural Stone Walkways',
    category: 'progress'
  }
];

async function uploadToR2(localPath, r2Key, contentType = 'image/jpeg') {
  const fileBuffer = fs.readFileSync(localPath);
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  );
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

async function main() {
  console.log('--- Copying and Uploading Amritha Vana Images ---');
  const results = {};

  // First copy flyer
  const flyerSrc = path.join(__dirname, '..', 'public', 'amrita-vana.jpeg');
  const flyerDest = path.join(publicDir, 'amrita-vana-brochure.jpg');
  if (fs.existsSync(flyerSrc)) {
    fs.copyFileSync(flyerSrc, flyerDest);
    const flyerR2Key = `properties/${USER_ID}/amritha-vana/amrita-vana-brochure.jpg`;
    const flyerUrl = await uploadToR2(flyerDest, flyerR2Key);
    results['brochure'] = {
      local: '/amritha-vana/amrita-vana-brochure.jpg',
      r2Url: flyerUrl,
      title: 'Official Project Brochure'
    };
    console.log('✓ Brochure copied & uploaded:', flyerUrl);
  }

  for (const item of imageMappings) {
    const srcPath = path.join(sourceDir, item.src);
    const destPath = path.join(publicDir, item.dest);
    
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      const r2Key = `properties/${USER_ID}/amritha-vana/${item.dest}`;
      const r2Url = await uploadToR2(destPath, r2Key);
      results[item.dest.replace('.jpg', '')] = {
        local: `/amritha-vana/${item.dest}`,
        r2Url,
        title: item.title,
        category: item.category
      };
      console.log(`✓ ${item.dest} -> ${r2Url}`);
    } else {
      console.warn(`! Not found: ${srcPath}`);
    }
  }

  const outputJson = path.join(__dirname, '..', 'public', 'amritha-vana', 'images.json');
  fs.writeFileSync(outputJson, JSON.stringify(results, null, 2));
  console.log('\n✓ Saved images mapping to:', outputJson);
}

main().catch(err => {
  console.error('Upload failed:', err);
  process.exit(1);
});
