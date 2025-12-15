// adrollsai/adrollsai/adrollsai-builder-app/app/api/creative/stamp/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { masterImageUrl, agentProfile, propertyId, masterCreativeId } = await request.json()

    if (!masterImageUrl) throw new Error("Missing Master Image URL")

    // 2. Fetch Resources
    const masterImageRes = await fetch(masterImageUrl)
    const masterArrayBuffer = await masterImageRes.arrayBuffer()
    const masterBuffer = Buffer.from(masterArrayBuffer)

    let logoBuffer: Buffer | null = null
    if (agentProfile.logo_url) {
      try {
        const logoRes = await fetch(agentProfile.logo_url)
        const logoArrayBuffer = await logoRes.arrayBuffer()
        logoBuffer = await sharp(Buffer.from(logoArrayBuffer))
          .resize(150, 150, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .toBuffer()
      } catch (e) {
        console.error("Failed to load agent logo", e)
      }
    }

    // 3. Stamping Logic
    const masterMetadata = await sharp(masterBuffer).metadata()
    const width = masterMetadata.width || 1080
    const height = masterMetadata.height || 1080
    const footerHeight = Math.round(height * 0.12)

    const footerSvg = `
      <svg width="${width}" height="${footerHeight}">
        <rect x="0" y="0" width="${width}" height="${footerHeight}" fill="#000000" />
        <text x="40" y="${footerHeight / 2 + 15}" font-family="sans-serif" font-size="${footerHeight * 0.35}" fill="white" font-weight="bold">
          ${agentProfile.business_name || 'Agent'}
        </text>
        <text x="${width - 40}" y="${footerHeight / 2 + 15}" font-family="sans-serif" font-size="${footerHeight * 0.35}" fill="#fbbf24" font-weight="bold" text-anchor="end">
          ${agentProfile.contact_number || ''}
        </text>
      </svg>
    `
    const footerBuffer = Buffer.from(footerSvg)

    const layers: sharp.OverlayOptions[] = [
      { input: footerBuffer, top: height - footerHeight, left: 0 }
    ]

    if (logoBuffer) {
      // Cast to any to fix TS error
      layers.push({ input: logoBuffer as any, top: 40, left: 40 })
    }

    // --- COMPRESSION APPLIED HERE ---
    // Switched from .png() to .jpeg({ quality: 80 })
    const finalImageBuffer = await sharp(masterBuffer)
      .composite(layers)
      .jpeg({ quality: 80, mozjpeg: true }) 
      .toBuffer()

    // 4. Upload to Cloudflare R2
    // Changed extension to .jpg
    const fileName = `stamped/${user.id}/${Date.now()}.jpg`
    
    try {
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: fileName,
        Body: finalImageBuffer,
        ContentType: 'image/jpeg' // Changed content type
      }))
    } catch (uploadError) {
      console.error("R2 Upload Failed:", uploadError)
      throw new Error("Failed to save image to storage")
    }

    // PREFIXED URL
    const publicUrl = `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`

    // 5. Save to DB
    await supabase.from('assets').insert({
        user_id: user.id,
        url: publicUrl,
        type: 'image',
        status: 'Stamped',
        property_id: propertyId,
        master_creative_id: masterCreativeId, 
        share_stats: { whatsapp: 0, facebook: 0, instagram: 0, download: 0 }
    })

    return NextResponse.json({ success: true, url: publicUrl })

  } catch (error: any) {
    console.error("Stamping Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}