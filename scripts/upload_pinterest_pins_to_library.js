const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');
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

const PINTEREST_PINS = [
  { url: 'https://i.pinimg.com/736x/7d/dc/3a/7ddc3a04f4b1e8294a54175d2ad49385.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/dd/5c/78/dd5c78a82c2f78b5dae6872edf618997.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/10/72/da/1072daa0cf00f7032166d8237106b0ea.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/27/b4/63/27b46330968515933371eb4c38ce9fa6.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/67/db/82/67db82c6cb71ea2f1368cd141b5d58be.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/4c/e8/b0/4ce8b0f2e0c1e6cd7dc77cf17d0bd62b.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/d3/64/b3/d364b37e06435eed2ed6193421a9a44a.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/8d/20/eb/8d20ebd835dbc95b0ff0947964654ee2.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/0a/7e/e3/0a7ee3a591ece8a38bbd0eca6bd9746e.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/7c/2e/08/7c2e0868d3f33f1607648fe0310f4022.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/58/c5/a0/58c5a06ac5a94fc33495f3010bb7733a.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/f6/dc/98/f6dc98fea7db2b9be15e80147d6e8e89.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/a0/96/8d/a0968db833aa2f284c953dfdb21db855.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/9b/a9/2f/9ba92f556c90208e8774ef52c0aa5e0c.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/04/f5/e5/04f5e5823014bd404b257cc2c4d45686.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/84/e4/17/84e4174066ab57aaacf6fb3b672a9a3c.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/b3/57/c7/b357c7788d977b7e3f641a7a6da7dd8f.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/be/c2/09/bec20971123431b70caf2c0edebf8509.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/68/31/15/6831156cd928a5b87cf3581c821ca1b1.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/ea/18/33/ea18338d65183930e9a86dcbd4f7ce10.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/19/dc/96/19dc9694ebc4a56ad7ed86facd2c15ec.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/c8/fa/da/c8fadab4648fca790a964239c4244436.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/51/24/2b/51242b15574584f4a60b3e2cf0e9fe7c.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/a5/03/82/a503826a0fc9ec03f793ab5c95f716f3.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/fb/a1/14/fba114ccde00f3c87dbe323c7d06dbcf.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/f0/35/2f/f0352fad013c83a5cbe81121183cd57f.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/8f/13/2f/8f132f0a2a00fcb2c8bd793eeb711396.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/f7/09/ad/f709ad90ed9d1ca94e7a180deef81bfd.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/30/ee/84/30ee8419c5fdab1aa131dca807c8b152.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/8c/43/3c/8c433c26fc627243b26d529b47f2a072.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/4d/82/20/4d8220f76fa59df4959a9c50199becad.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/bd/ad/ff/bdadffb3656cf799719c4f3bdcf5060d.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/f2/26/13/f2261363e66b5fd19a04552ee2100094.jpg', category: 'premium' },
  { url: 'https://i.pinimg.com/736x/68/55/30/685530592eed1b0311058c246497ac4f.jpg', category: 'high_converting' },
  { url: 'https://i.pinimg.com/736x/58/d1/c1/58d1c1ae13193e3ac356abaaa5d4ec8b.jpg', category: 'premium' }
];

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function uploadToR2(buffer, key, contentType = 'image/jpeg') {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${R2_PUBLIC_URL}/${key}`;
}

async function main() {
  console.log('1. Clearing ALL existing reference_creatives from Supabase table...');
  const { error: delErr } = await supabaseAdmin
    .from('reference_creatives')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  
  if (delErr) {
    console.error('Delete error:', delErr);
    process.exit(1);
  }
  console.log('✓ Successfully wiped all old reference creatives.');

  console.log(`\n2. Downloading and uploading ${PINTEREST_PINS.length} Pinterest pins to R2 & Supabase...`);
  const timestamp = Date.now();
  const uploadedResults = [];

  for (let i = 0; i < PINTEREST_PINS.length; i++) {
    const item = PINTEREST_PINS[i];
    try {
      process.stdout.write(`Downloading [${i + 1}/${PINTEREST_PINS.length}] ${item.url}... `);
      const imgBuffer = await downloadImage(item.url);
      
      const r2Key = `reference-creatives/dubai/pinterest_pin_${timestamp}_${i}.jpg`;
      const publicUrl = await uploadToR2(imgBuffer, r2Key, 'image/jpeg');
      
      // Insert to Supabase with user_id = null (Super Admin / Global library)
      const { data, error: insErr } = await supabaseAdmin
        .from('reference_creatives')
        .insert({
          category: item.category,
          url: publicUrl,
          user_id: null
        })
        .select()
        .single();

      if (insErr) {
        console.error('\nInsert error for pin', i, insErr);
      } else {
        uploadedResults.push({ id: data.id, index: i, url: publicUrl, category: item.category });
        console.log(`Uploaded! R2 URL: ${publicUrl}`);
      }
    } catch (err) {
      console.error(`\nFailed on pin ${i}:`, err.message);
    }
  }

  console.log(`\n✓ Finished! Uploaded ${uploadedResults.length} Pinterest pins to reference_creatives.`);
  console.log('\nTop 6 Curated for Creation Templates:');
  uploadedResults.slice(0, 6).forEach((res, idx) => {
    console.log(`Template ${idx + 1}: ${res.url}`);
  });
}

main().catch(console.error);
