// adrollsai/adrollsai/adrollsai-builder-app-local-cache/utils/stamp-helper.ts

import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'
import path from 'path'
import process from 'process'
import fs from 'fs' 

// --- HELPER: Fix R2 URL ---
function fixR2Url(url: string) {
  if (!url) return ''
  if (url.includes('.r2.dev') && !url.includes('/adrolls-storage/')) {
    return url.replace('.r2.dev/', '.r2.dev/adrolls-storage/')
  }
  return url
}

// --- FONT INIT ---
export function initFonts() {
  try {
    if (process.env.FONTCONFIG_PATH) return;

    const cwd = process.cwd();
    const searchPaths = [
        path.join(cwd, 'fonts'),
        '/var/task/fonts',
        path.join(cwd, 'public', 'fonts')
    ];

    const fontDir = searchPaths.find(p => fs.existsSync(path.join(p, 'fonts.conf')));

    if (fontDir) {
        process.env.FONTCONFIG_PATH = fontDir;
        process.env.FONTCONFIG_FILE = path.join(fontDir, 'fonts.conf');
    }
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

  // 2. Analyze Dimensions
  const STANDARD_WIDTH = 1080;
  
  // Get original metadata
  const metadata = await sharp(originalBuffer).metadata();
  const originalWidth = metadata.width || 1080;
  const originalHeight = metadata.height || 1080;
  
  // Calculate target height to preserve exact aspect ratio of input
  const scaleFactor = STANDARD_WIDTH / originalWidth;
  const targetHeight = Math.round(originalHeight * scaleFactor);

  // 3. Footer Calculations
  const footerHeight = Math.round(STANDARD_WIDTH * 0.15) 
  const padding = Math.round(footerHeight * 0.15)
  const logoSize = Math.round(footerHeight * 0.70)

  // 4. Calculate Image Area
  const availableImageHeight = targetHeight - footerHeight;

  // 5. Resize Image (FIT WITHOUT CROP)
  // fit: 'contain' ensures the entire image is visible within the box
  const resizedImageBuffer = await sharp(originalBuffer)
      .resize({
          width: STANDARD_WIDTH,
          height: availableImageHeight,
          fit: 'contain', 
          background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .toBuffer();

  // 6. Process Agent Logo
  let logoBuffer: Buffer | null = null
  if (agentProfile.logo_url) {
    try {
      const safeLogoUrl = fixR2Url(agentProfile.logo_url)
      const logoRes = await fetch(safeLogoUrl)
      if (logoRes.ok) {
        const logoArrayBuffer = await logoRes.arrayBuffer()
        logoBuffer = await sharp(Buffer.from(logoArrayBuffer))
          .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .toBuffer()
      }
    } catch (e) {
      console.error("Failed to load agent logo", e)
    }
  }

  // 7. Design Variables
  const primaryTextColor = "#1F2937"; 
  const secondaryTextColor = "#B45309"; 
  const borderColor = "#E5E7EB"; 
  const dividerColor = "#D1D5DB";

  const textStartX = logoBuffer ? (padding * 2 + logoSize) : padding
  const fontSizeName = Math.round(footerHeight * 0.28)
  const fontSizePhone = Math.round(footerHeight * 0.28)
  const iconSize = fontSizePhone;
  
  const phoneText = agentProfile.contact_number || 'Contact Me';
  const businessName = agentProfile.business_name || 'Real Estate Agent';

  // --- LAYOUT LOGIC ---
  const approxPhoneWidth = phoneText.length * (fontSizePhone * 0.6); 
  const iconX = STANDARD_WIDTH - padding - approxPhoneWidth - iconSize - (padding * 0.5);
  const dividerX = iconX - (padding * 1.5);
  
  const rightBoundary = agentProfile.contact_number ? dividerX : (STANDARD_WIDTH - padding);
  const availableWidth = rightBoundary - textStartX - padding;
  
  // --- TEXT WRAPPING LOGIC ---
  const avgCharWidth = fontSizeName * 0.55; 
  const maxChars = Math.floor(availableWidth / avgCharWidth);

  const words = businessName.split(' ');
  let lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
      if ((currentLine + " " + words[i]).length <= maxChars) {
          currentLine += " " + words[i];
      } else {
          lines.push(currentLine);
          currentLine = words[i];
      }
  }
  lines.push(currentLine);

  if (lines.length > 2) {
      lines[1] = lines.slice(1).join(" ");
      lines = lines.slice(0, 2);
  }

  // --- GENERATE NAME SVG ---
  let nameSvg = '';
  const lineHeight = fontSizeName * 1.15;

  if (lines.length === 1) {
      nameSvg = `<text 
          x="${textStartX}" 
          y="${footerHeight / 2 + (fontSizeName / 3)}" 
          font-family="Poppins" 
          font-size="${fontSizeName}" 
          fill="${primaryTextColor}" 
          font-weight="bold"
          style="text-transform: uppercase; letter-spacing: 0.5px;"
      >
        ${lines[0]}
      </text>`;
  } else {
      const totalTextHeight = lines.length * lineHeight;
      const startY = (footerHeight - totalTextHeight) / 2 + (fontSizeName * 0.8);
      
      lines.forEach((line, index) => {
          nameSvg += `<text 
              x="${textStartX}" 
              y="${startY + (index * lineHeight)}" 
              font-family="Poppins" 
              font-size="${fontSizeName}" 
              fill="${primaryTextColor}" 
              font-weight="bold"
              style="text-transform: uppercase; letter-spacing: 0.5px;"
          >
            ${line}
          </text>`;
      });
  }

  // 8. SVG Footer
  const footerSvg = `
    <svg width="${STANDARD_WIDTH}" height="${footerHeight}">
      <line x1="0" y1="0" x2="${STANDARD_WIDTH}" y2="0" style="stroke:${borderColor};stroke-width:2" />
      ${agentProfile.contact_number ? `<line x1="${dividerX}" y1="${footerHeight * 0.2}" x2="${dividerX}" y2="${footerHeight * 0.8}" style="stroke:${dividerColor};stroke-width:2" />` : ''}

      ${nameSvg}
      
      ${agentProfile.contact_number ? `
      <g transform="translate(${iconX}, ${(footerHeight - iconSize) / 2}) scale(${iconSize / 24})">
          <path 
              d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.05 12.05 0 0 0 .57 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.03 12.03 0 0 0 2.81.57A2 2 0 0 1 22 16.92z" 
              fill="${secondaryTextColor}" 
          />
      </g>
      <text 
          x="${STANDARD_WIDTH - padding}" 
          y="${footerHeight / 2 + (fontSizePhone / 3)}" 
          font-family="Poppins" 
          font-size="${fontSizePhone}" 
          fill="${secondaryTextColor}" 
          font-weight="bold" 
          text-anchor="end"
        >
        ${phoneText}
      </text>
      ` : ''}
    </svg>
  `

  // 9. Composite
  const layers: any[] = [
    { input: resizedImageBuffer, top: 0, left: 0 },
    { input: Buffer.from(footerSvg), top: availableImageHeight, left: 0 }
  ]

  if (logoBuffer) {
    const logoTop = availableImageHeight + Math.round((footerHeight - logoSize) / 2)
    layers.push({ input: logoBuffer, top: logoTop, left: padding })
  }

  const finalImageBuffer = await sharp({
      create: {
          width: STANDARD_WIDTH,
          height: targetHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
  })
    .composite(layers)
    .jpeg({ quality: 90 }) 
    .toBuffer()

  // 10. Upload to R2
  const fileName = `stamped/${userId}/${Date.now()}.jpg`
  
  await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: fileName,
      Body: finalImageBuffer,
      ContentType: 'image/jpeg'
  }))

  return `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`
}