const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES = {
   // Hero
   hero: {
      url: 'https://i.ibb.co/HwJ0bnZ/compare.png',
      width: 1200,
      filename: 'hero_compare.webp'
   },
   // Logos
   logo_bluesquare: {
      url: 'https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/2f62a259-f23b-48ee-a920-c436f36eaa4b-1777536311805.jpg',
      width: 128,
      filename: 'logo_bluesquare.webp'
   },
   logo_homcom: {
      url: 'https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1778751282660.jpeg',
      width: 128,
      filename: 'logo_homcom.webp'
   },
   logo_gnrhomes: {
      url: 'https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/42d2e0c5-4fe6-4738-8a9f-63f09be01f12-1778827763343.png',
      width: 128,
      filename: 'logo_gnrhomes.webp'
   },
   logo_realtynation: {
      url: 'https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/c890a11f-84ce-4592-ab8f-8682927b1a9d-1778916086679.png',
      width: 128,
      filename: 'logo_realtynation.webp'
   },
   logo_yourlocalagency: {
      url: 'https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/6164b910-af29-4976-8b1a-f0885d2caaec-1778680066756.png',
      width: 128,
      filename: 'logo_yourlocalagency.webp'
   },
   // Static Creative Graphics
   graphic_1: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1780308660323.png',
      width: 600,
      filename: 'graphic_1.webp'
   },
   graphic_2: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1780308586608.png',
      width: 600,
      filename: 'graphic_2.webp'
   },
   graphic_3: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1780109222082.png',
      width: 600,
      filename: 'graphic_3.webp'
   },
   graphic_4: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1780018509263.png',
      width: 600,
      filename: 'graphic_4.webp'
   },
   graphic_5: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/1780904690138.png',
      width: 600,
      filename: 'graphic_5.webp'
   },
   graphic_6: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/1779447936200.png',
      width: 600,
      filename: 'graphic_6.webp'
   },
   graphic_7: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/1779447925050.png',
      width: 600,
      filename: 'graphic_7.webp'
   },
   graphic_8: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/1781132190243.png',
      width: 600,
      filename: 'graphic_8.webp'
   },
   graphic_9: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/1780662095979.png',
      width: 600,
      filename: 'graphic_9.webp'
   },
   graphic_10: {
      url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/1780661995672.png',
      width: 600,
      filename: 'graphic_10.webp'
   }
};

const outputDir = path.join(__dirname, '..', 'public', 'images', 'optimized');

if (!fs.existsSync(outputDir)) {
   fs.mkdirSync(outputDir, { recursive: true });
}

async function processImages() {
   console.log('Starting landing page image optimizations...');
   
   for (const [key, spec] of Object.entries(IMAGES)) {
      console.log(`Processing ${key}: ${spec.filename}...`);
      try {
         const response = await fetch(spec.url);
         if (!response.ok) {
            throw new Error(`Failed to download ${spec.url}: ${response.statusText}`);
         }
         
         const buffer = Buffer.from(await response.arrayBuffer());
         
         const outputPath = path.join(outputDir, spec.filename);
         
         await sharp(buffer)
            .resize({ width: spec.width, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(outputPath);
            
         const originalSize = buffer.length;
         const newSize = fs.statSync(outputPath).size;
         const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
         
         console.log(`✅ Saved ${spec.filename}: ${(originalSize / 1024).toFixed(1)} KB -> ${(newSize / 1024).toFixed(1)} KB (${savings}% savings)`);
      } catch (err) {
         console.error(`❌ Failed to process ${key}:`, err.message);
      }
   }
   
   console.log('All landing page image optimizations complete!');
}

processImages();
