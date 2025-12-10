import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import sharp from 'sharp'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // UPDATED: Now accepting masterCreativeId
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

    const layers = [
      { input: footerBuffer, top: height - footerHeight, left: 0 }
    ]

    if (logoBuffer) {
      layers.push({ input: logoBuffer, top: 40, left: 40 })
    }

    const finalImageBuffer = await sharp(masterBuffer)
      .composite(layers)
      .png()
      .toBuffer()

    // 4. Upload
    const fileName = `stamped/${user.id}-${Date.now()}.png`
    const { error: uploadError } = await supabase.storage
      .from('assets')
      .upload(fileName, finalImageBuffer, { contentType: 'image/png' })

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(fileName)

    // 5. Save to DB (UPDATED: Saving master_creative_id)
    await supabase.from('assets').insert({
        user_id: user.id,
        url: publicUrl,
        type: 'image',
        status: 'Stamped',
        property_id: propertyId,
        master_creative_id: masterCreativeId, // <--- Key for Analytics
        share_stats: { whatsapp: 0, facebook: 0, instagram: 0, download: 0 }
    })

    return NextResponse.json({ success: true, url: publicUrl })

  } catch (error: any) {
    console.error("Stamping Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}