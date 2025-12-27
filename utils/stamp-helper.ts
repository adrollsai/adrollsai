import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'
import path from 'path'
import process from 'process'

// --- HELPER: Fix R2 URL ---
function fixR2Url(url: string) {
  if (!url) return ''
  if (url.includes('.r2.dev') && !url.includes('/adrolls-storage/')) {
    return url.replace('.r2.dev/', '.r2.dev/adrolls-storage/')
  }
  return url
}

// --- HELPER: Phone Formatter ---
function formatPhoneNumber(phone: string) {
  const cleaned = ('' + phone).replace(/\D/g, '')
  if (cleaned.length === 10) {
    const part1 = cleaned.substring(0, 5)
    const part2 = cleaned.substring(5, 10)
    return `+91-${part1} ${part2}`
  }
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
     const part1 = cleaned.substring(2, 7)
     const part2 = cleaned.substring(7, 12)
     return `+91-${part1} ${part2}`
  }
  return phone
}

// --- FONT INIT ---
export function initFonts() {
  try {
    if (process.env.FONTCONFIG_PATH) return;
    const isProd = process.env.NODE_ENV === 'production';
    const fontDir = isProd ? '/var/task/fonts' : path.join(process.cwd(), 'fonts');
    process.env.FONTCONFIG_PATH = fontDir;
    process.env.FONTCONFIG_FILE = path.join(fontDir, 'fonts.conf');
  } catch (error) {
    console.error("Error initializing fonts:", error);
  }
}

// --- MAIN FUNCTION ---
export async function generateStampedImage(params: any) {
  initFonts();

  const { agentProfile, masterImageUrl, userId } = params;

  // 1. Fetch Master Image
  const safeMasterUrl = fixR2Url(masterImageUrl)
  const masterImageRes = await fetch(safeMasterUrl)
  if (!masterImageRes.ok) throw new Error(`Failed to fetch master image`)
  const masterArrayBuffer = await masterImageRes.arrayBuffer()
  const originalBuffer = Buffer.from(masterArrayBuffer)

  // 2. Resize to Standard 1080px
  const STANDARD_WIDTH = 1080;
  const resizedImage = await sharp(originalBuffer)
      .resize(STANDARD_WIDTH, null, { withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
  
  const optimizedBuffer = resizedImage.data; 
  const { width, height } = resizedImage.info;

  // 3. Layout Constants
  const footerHeight = 220; 
  const accentColor = "#B45309"; // Gold/Bronze
  const textColor = "#1F2937";   // Dark Grey
  const dividerColor = "#E5E7EB"; // Light Grey
  
  // Section Layout
  const logoSectionWidth = 280; 
  const remainingWidth = width - logoSectionWidth;
  const sectionWidth = remainingWidth / 2; 

  // 4. Process Agent Logo
  const logoBoxSize = 160; 
  let logoBuffer: Buffer | null = null
  if (agentProfile.logo_url) {
    try {
      const safeLogoUrl = fixR2Url(agentProfile.logo_url)
      const logoRes = await fetch(safeLogoUrl)
      if (logoRes.ok) {
        const logoArrayBuffer = await logoRes.arrayBuffer()
        logoBuffer = await sharp(Buffer.from(logoArrayBuffer))
          .resize(logoBoxSize, logoBoxSize, { 
            fit: 'contain', 
            background: { r: 0, g: 0, b: 0, alpha: 0 } 
          })
          .toBuffer()
      }
    } catch (e) {
      console.error("Failed to load logo", e)
    }
  }

  // 5. Content
  const rawName = agentProfile.business_name || 'Real Estate Agent';
  const name = rawName.toUpperCase(); 
  
  const rawPhone = agentProfile.contact_number || 'Contact Me';
  const phone = formatPhoneNumber(rawPhone);

  const fontSizeText = 24; 
  const circleRadius = 28; 
  
  // ICONS (Material Design - Standard 24x24)
  // Work Icon (Briefcase)
  const businessIconPath = "M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-2 .89-2 2v11c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-8-2h4v2h-4V4zM4 8h16v11H4V8z";
  
  // Phone Icon (Standard Handset - Restored)
  const phoneIconPath = "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 1.23 0 2.44.2 3.57.57.35.13.74.04 1.02-.24l2.2-2.2z";

  // Coordinates
  const circleY = 80;
  const textY = 150;

  const section1Center = sectionWidth / 2;
  const section2Center = sectionWidth + (sectionWidth / 2);
  const logoCenter = width - (logoSectionWidth / 2);

  const sep1X = sectionWidth;
  const sep2X = width - logoSectionWidth;

  // 6. SVG Construction
  const footerSvg = `
    <svg width="${width}" height="${footerHeight}">
      <rect x="0" y="0" width="${width}" height="${footerHeight}" fill="#FFFFFF" />
      <rect x="0" y="0" width="${width}" height="6" fill="${accentColor}" />

      <line x1="${sep1X}" y1="40" x2="${sep1X}" y2="${footerHeight - 40}" stroke="${dividerColor}" stroke-width="2" />
      <line x1="${sep2X}" y1="40" x2="${sep2X}" y2="${footerHeight - 40}" stroke="${dividerColor}" stroke-width="2" />

      <g transform="translate(${section1Center}, 0)">
         <circle cx="0" cy="${circleY}" r="${circleRadius}" fill="${accentColor}" />
         <g transform="translate(-12, ${circleY - 12})">
            <path d="${businessIconPath}" fill="#FFFFFF" />
         </g>
         <text x="0" y="${textY}" font-family="Poppins" font-size="${fontSizeText}" fill="${textColor}" font-weight="bold" text-anchor="middle" letter-spacing="1">
            ${name}
         </text>
      </g>

      <g transform="translate(${section2Center}, 0)">
         <circle cx="0" cy="${circleY}" r="${circleRadius}" fill="${accentColor}" />
         <g transform="translate(-12, ${circleY - 12})">
            <path d="${phoneIconPath}" fill="#FFFFFF" />
         </g>
         <text x="0" y="${textY}" font-family="Poppins" font-size="${fontSizeText}" fill="${textColor}" font-weight="bold" text-anchor="middle">
            ${phone}
         </text>
      </g>
      
      ${!logoBuffer ? `
        <text x="${logoCenter}" y="${footerHeight/2 + 10}" font-family="Poppins" font-size="20" fill="${dividerColor}" text-anchor="middle">NO LOGO</text>
      ` : ''}

    </svg>
  `

  // 7. Composite
  const extendedImage = await sharp(optimizedBuffer) 
      .extend({
          bottom: footerHeight,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
      })

  const layers: any[] = [
    { input: Buffer.from(footerSvg), top: height, left: 0 }
  ]

  if (logoBuffer) {
    const logoTop = height + Math.round((footerHeight - logoBoxSize) / 2)
    const logoLeft = Math.round(width - logoSectionWidth + (logoSectionWidth - logoBoxSize) / 2)
    layers.push({ input: logoBuffer, top: logoTop, left: logoLeft })
  }

  const finalImageBuffer = await extendedImage
    .composite(layers)
    .jpeg({ quality: 95 }) 
    .toBuffer()

  // 8. Upload
  const fileName = `stamped/${userId}/${Date.now()}.jpg`
  
  await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: fileName,
      Body: finalImageBuffer,
      ContentType: 'image/jpeg'
  }))

  return `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`
}