import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'
import path from 'path'
import process from 'process'

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

// --- MAIN FUNCTION (Footer Implementation) ---
export async function generateStampedImage(params: any) {
  initFonts();

  const { agentProfile, masterImageUrl } = params;

  // 1. Fetch Master Image
  const masterImageRes = await fetch(masterImageUrl)
  if (!masterImageRes.ok) throw new Error("Failed to fetch master image")
  const masterArrayBuffer = await masterImageRes.arrayBuffer()
  const originalBuffer = Buffer.from(masterArrayBuffer)

  // 2. Resize to Standard 1080px Width
  const STANDARD_WIDTH = 1080;
  const resizedImage = await sharp(originalBuffer)
      .resize(STANDARD_WIDTH, null, { withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
  
  const optimizedBuffer = resizedImage.data; 
  const { width, height } = resizedImage.info;

  // 3. Footer Calculations
  const footerHeight = Math.round(width * 0.15) 
  const padding = Math.round(footerHeight * 0.15)
  const logoSize = Math.round(footerHeight * 0.70)

  // 4. Process Agent Logo
  let logoBuffer: Buffer | null = null
  if (agentProfile.logo_url) {
    try {
      const logoRes = await fetch(agentProfile.logo_url)
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

  // 5. Design Constants
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

  const approxPhoneWidth = phoneText.length * (fontSizePhone * 0.6); 
  const iconX = width - padding - approxPhoneWidth - iconSize - (padding * 0.5);
  const dividerX = iconX - (padding * 1.5);

  // 6. SVG Footer Construction
  const footerSvg = `
    <svg width="${width}" height="${footerHeight}">
      <line x1="0" y1="0" x2="${width}" y2="0" style="stroke:${borderColor};stroke-width:2" />
      ${agentProfile.contact_number ? `<line x1="${dividerX}" y1="${footerHeight * 0.2}" x2="${dividerX}" y2="${footerHeight * 0.8}" style="stroke:${dividerColor};stroke-width:2" />` : ''}

      <text 
          x="${textStartX}" 
          y="${footerHeight / 2 + (fontSizeName / 3)}" 
          font-family="Poppins" 
          font-size="${fontSizeName}" 
          fill="${primaryTextColor}" 
          font-weight="800"
          style="text-transform: uppercase; letter-spacing: 0.5px;"
      >
        ${businessName}
      </text>
      
      ${agentProfile.contact_number ? `
      <g transform="translate(${iconX}, ${(footerHeight - iconSize) / 2}) scale(${iconSize / 24})">
          <path 
              d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.05 12.05 0 0 0 .57 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.03 12.03 0 0 0 2.81.57A2 2 0 0 1 22 16.92z" 
              fill="${secondaryTextColor}" 
          />
      </g>
      <text 
          x="${width - padding}" 
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

  // 7. Composite: Extend Image Bottom + Add SVG + Add Logo
  const extendedImage = await sharp(optimizedBuffer) 
      .extend({
          bottom: footerHeight,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
      })

  const layers: any[] = [
    { input: Buffer.from(footerSvg), top: height, left: 0 }
  ]

  if (logoBuffer) {
    const logoTop = height + Math.round((footerHeight - logoSize) / 2)
    layers.push({ input: logoBuffer, top: logoTop, left: padding })
  }

  const finalImageBuffer = await extendedImage
    .composite(layers)
    .jpeg({ quality: 90 }) 
    .toBuffer()

  // 8. Upload
  const fileName = `stamped/${agentProfile.id}/${Date.now()}.jpg`
  
  await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: fileName,
      Body: finalImageBuffer,
      ContentType: 'image/jpeg'
  }))

  return `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`
}