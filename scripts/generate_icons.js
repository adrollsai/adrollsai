const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = path.join(__dirname, '..', 'public', 'nobogent-logo.png');
const PUBLIC = path.join(__dirname, '..', 'public');
const APP = path.join(__dirname, '..', 'app');

async function generate() {
  console.log('Generating icons from colored Nobogent logo...');

  // 1. logo.png — 512x512 with white background for PWA splash etc
  await sharp(SOURCE)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(PUBLIC, 'logo.png'));
  console.log('✅ logo.png (512x512)');

  // 2. icon.png — same as logo.png
  await sharp(SOURCE)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(PUBLIC, 'icon.png'));
  console.log('✅ icon.png (512x512)');

  // 3. icon-512x512.png
  await sharp(SOURCE)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(PUBLIC, 'icon-512x512.png'));
  console.log('✅ icon-512x512.png');

  // 4. icon-192x192.png
  await sharp(SOURCE)
    .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(PUBLIC, 'icon-192x192.png'));
  console.log('✅ icon-192x192.png');

  // 5. favicon.ico (as a 48x48 PNG — modern browsers accept PNG favicons)
  const faviconBuffer = await sharp(SOURCE)
    .resize(48, 48, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), faviconBuffer);
  fs.writeFileSync(path.join(APP, 'favicon.ico'), faviconBuffer);
  console.log('✅ favicon.ico (48x48 PNG) in public/ and app/');

  console.log('\n🎉 All icons generated successfully from colored Nobogent logo!');
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
