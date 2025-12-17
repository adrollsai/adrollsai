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
    const { masterImageUrl, propertyId, masterCreativeId } = await request.json()
    if (!masterImageUrl) throw new Error("Missing Master Image URL")

    // 2. Fetch Latest Profile
    const { data: agentProfile } = await supabase
      .from('profiles')
      .select('business_name, contact_number, logo_url, current_streak, last_activity_date, total_xp, level, badges')
      .eq('id', user.id)
      .single()

    if (!agentProfile) throw new Error("Profile not found")

    // DEBUG: Check what data is actually being used
    console.log("--- STAMPING DEBUG ---")
    console.log("Agent:", agentProfile.business_name)
    console.log("Phone:", agentProfile.contact_number)
    console.log("Logo:", agentProfile.logo_url ? "Yes" : "No")

    // --- GAMIFICATION LOGIC START ---
    // (Kept identical to your previous code)
    const currentStats = agentProfile 
    const now = new Date()
    const lastDate = currentStats?.last_activity_date ? new Date(currentStats.last_activity_date) : null
    
    let newStreak = currentStats?.current_streak || 0
    let newXp = (currentStats?.total_xp || 0) + 50 
    let currentBadges = currentStats?.badges || []
    let newBadges: string[] = [...currentBadges]
    let earnedBadgeName: string | null = null
    
    if (lastDate) {
      const isToday = lastDate.toDateString() === now.toDateString()
      const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === lastDate.toDateString()
      now.setDate(new Date().getDate()) 

      if (!isToday) {
        if (isYesterday) {
          newStreak += 1
        } else {
          newStreak = 1 
        }
      }
    } else {
      newStreak = 1 
    }

    const MILESTONES = [
        { days: 7, id: 'streak_7', xp: 500, name: 'Week Warrior' },
        { days: 30, id: 'streak_30', xp: 2000, name: 'Consistency King' },
        { days: 100, id: 'streak_100', xp: 5000, name: 'Century Club' }
    ]

    const milestone = MILESTONES.find(m => m.days === newStreak)
    if (milestone && !newBadges.includes(milestone.id)) {
        newBadges.push(milestone.id)
        newXp += milestone.xp
        earnedBadgeName = milestone.name
    }

    const newLevel = Math.floor(newXp / 1000) + 1

    await supabase.from('profiles').update({
        current_streak: newStreak,
        last_activity_date: new Date().toISOString(),
        total_xp: newXp,
        level: newLevel,
        badges: newBadges
    }).eq('id', user.id)
    // --- GAMIFICATION LOGIC END ---

    // 3. Fetch & OPTIMIZE Master Image
    const masterImageRes = await fetch(masterImageUrl)
    const masterArrayBuffer = await masterImageRes.arrayBuffer()
    let masterBuffer = Buffer.from(masterArrayBuffer)

    // OPTIMIZATION: Resize to Standard 1080px Width
    // This fixes the "Taking too long" issue and ensures footer ratio is always perfect.
    const STANDARD_WIDTH = 1080;
    
    const resizedImage = await sharp(masterBuffer)
        .resize(STANDARD_WIDTH, null, { // null height maintains aspect ratio
            withoutEnlargement: true // Don't upscale small images
        })
        .toBuffer({ resolveWithObject: true }); // Get buffer AND info
    
    masterBuffer = resizedImage.data;
    const { width, height } = resizedImage.info;

    // 4. Calculate Footer Dimensions (Based on Standard Width)
    const footerHeight = Math.round(width * 0.15) // 162px for 1080w
    const padding = Math.round(footerHeight * 0.15)
    const logoSize = Math.round(footerHeight * 0.70)

    // 5. Process Agent Logo
    let logoBuffer: Buffer | null = null
    if (agentProfile.logo_url) {
      try {
        const logoRes = await fetch(agentProfile.logo_url)
        const logoArrayBuffer = await logoRes.arrayBuffer()
        logoBuffer = await sharp(Buffer.from(logoArrayBuffer))
          .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .toBuffer()
      } catch (e) {
        console.error("Failed to load agent logo", e)
      }
    }

    // 6. Define Design Variables
    const primaryTextColor = "#1F2937"; 
    const secondaryTextColor = "#B45309"; 
    const borderColor = "#E5E7EB"; 
    const dividerColor = "#D1D5DB";

    // 7. SVG Construction
    const textStartX = logoBuffer ? (padding * 2 + logoSize) : padding
    const fontSizeName = Math.round(footerHeight * 0.28) // ~45px
    const fontSizePhone = Math.round(footerHeight * 0.28) // ~45px
    const iconSize = fontSizePhone;
    
    const phoneText = agentProfile.contact_number || 'Contact Me'; // Fallback text
    const businessName = agentProfile.business_name || 'Real Estate Agent'; // Fallback text

    // Layout Logic
    // We align the phone section to the RIGHT.
    // Icon X = Width - Padding - TextWidth - IconSize - Gap
    const approxPhoneWidth = phoneText.length * (fontSizePhone * 0.6); 
    const iconX = width - padding - approxPhoneWidth - iconSize - (padding * 0.5);
    const dividerX = iconX - (padding * 1.5);

    const footerSvg = `
      <svg width="${width}" height="${footerHeight}">
        <line x1="0" y1="0" x2="${width}" y2="0" style="stroke:${borderColor};stroke-width:2" />

        ${agentProfile.contact_number ? `<line x1="${dividerX}" y1="${footerHeight * 0.2}" x2="${dividerX}" y2="${footerHeight * 0.8}" style="stroke:${dividerColor};stroke-width:2" />` : ''}

        <text 
            x="${textStartX}" 
            y="${footerHeight / 2 + (fontSizeName / 3)}" 
            font-family="sans-serif" 
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
            font-family="sans-serif" 
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
    const footerBuffer = Buffer.from(footerSvg)

    // 8. Composite
    const extendedImage = await sharp(masterBuffer)
        .extend({
            bottom: footerHeight,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        })

    const layers: sharp.OverlayOptions[] = [
      { input: footerBuffer, top: height, left: 0 }
    ]

    if (logoBuffer) {
      // Centered vertically in the footer
      const logoTop = height + Math.round((footerHeight - logoSize) / 2)
      layers.push({ input: logoBuffer as any, top: logoTop, left: padding })
    }

    const finalImageBuffer = await extendedImage
      .composite(layers)
      .jpeg({ quality: 90 }) // Slightly lower quality for faster speed, still looks great
      .toBuffer()

    // 9. Upload
    const fileName = `stamped/${user.id}/${Date.now()}.jpg`
    
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: fileName,
        Body: finalImageBuffer,
        ContentType: 'image/jpeg'
    }))

    const publicUrl = `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`

    // 10. Save to DB
    await supabase.from('assets').insert({
        user_id: user.id,
        url: publicUrl,
        type: 'image',
        status: 'Stamped',
        property_id: propertyId,
        master_creative_id: masterCreativeId, 
        share_stats: { whatsapp: 0, facebook: 0, instagram: 0, download: 0 }
    })

    return NextResponse.json({ 
        success: true, 
        url: publicUrl, 
        xpEarned: newXp - (currentStats?.total_xp || 0),
        streak: newStreak,
        newBadge: earnedBadgeName 
    })

  } catch (error: any) {
    console.error("Stamping Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}