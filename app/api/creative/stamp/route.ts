// adrollsai/adrollsai/adrollsai-builder-app-gamification-superuser/app/api/creative/stamp/route.ts

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

    // --- GAMIFICATION LOGIC START ---
    const { data: currentStats } = await supabase
      .from('profiles')
      .select('current_streak, last_activity_date, total_xp, level, badges')
      .eq('id', user.id)
      .single()

    const now = new Date()
    const lastDate = currentStats?.last_activity_date ? new Date(currentStats.last_activity_date) : null
    
    let newStreak = currentStats?.current_streak || 0
    let newXp = (currentStats?.total_xp || 0) + 50 // Base XP
    let currentBadges = currentStats?.badges || []
    let newBadges: string[] = [...currentBadges]
    let earnedBadgeName: string | null = null
    
    // Streak Calculation
    if (lastDate) {
      const isToday = lastDate.toDateString() === now.toDateString()
      const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === lastDate.toDateString()
      
      // Reset date to 'now'
      now.setDate(new Date().getDate()) 

      if (!isToday) {
        if (isYesterday) {
          newStreak += 1
        } else {
          newStreak = 1 // Reset
        }
      }
    } else {
      newStreak = 1 
    }

    // --- MILESTONE CHECK ---
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

    // Level Calculation
    const newLevel = Math.floor(newXp / 1000) + 1

    // Update Profile
    await supabase.from('profiles').update({
        current_streak: newStreak,
        last_activity_date: new Date().toISOString(),
        total_xp: newXp,
        level: newLevel,
        badges: newBadges
    }).eq('id', user.id)
    // --- GAMIFICATION LOGIC END ---

    // 2. Fetch Resources
    const masterImageRes = await fetch(masterImageUrl)
    const masterArrayBuffer = await masterImageRes.arrayBuffer()
    const masterBuffer = Buffer.from(masterArrayBuffer)

    // Get dimensions first
    const masterMetadata = await sharp(masterBuffer).metadata()
    const width = masterMetadata.width || 1080
    const height = masterMetadata.height || 1080
    
    // Calculate Footer Dimensions
    const footerHeight = Math.round(width * 0.15) // 15% of width
    const padding = Math.round(footerHeight * 0.15)
    const logoSize = Math.round(footerHeight * 0.70)

    // 2a. Process Logo
    let logoBuffer: Buffer | null = null

    if (agentProfile.logo_url) {
      try {
        const logoRes = await fetch(agentProfile.logo_url)
        const logoArrayBuffer = await logoRes.arrayBuffer()
        
        // Resize logo to fit nicely
        logoBuffer = await sharp(Buffer.from(logoArrayBuffer))
          .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .toBuffer()
      } catch (e) {
        console.error("Failed to load agent logo", e)
      }
    }

    // 3. Define Design Variables
    const backgroundColor = { r: 255, g: 255, b: 255, alpha: 1 }; // Pure White
    const primaryTextColor = "#1F2937"; // Gray 800 (Soft Black)
    const secondaryTextColor = "#B45309"; // Amber 700 (Elegant Dark Gold/Orange)
    const borderColor = "#E5E7EB"; // Gray 200 (Separator lines)
    const dividerColor = "#D1D5DB"; // Gray 300 (Vertical Divider)

    // 4. Stamping Logic

    // Layout Calculation
    // Left Side (Logo + Name)
    const textStartX = logoBuffer ? (padding * 2 + logoSize) : padding
    const fontSizeName = Math.round(footerHeight * 0.28)
    
    // Right Side (Phone + Icon)
    const fontSizePhone = Math.round(footerHeight * 0.28)
    const iconSize = fontSizePhone;
    
    // Estimate width of phone number text to position the icon correctly
    // Average char width approx 0.6em
    const phoneText = agentProfile.contact_number || '';
    const approxPhoneWidth = phoneText.length * (fontSizePhone * 0.6);
    
    // Position of Icon: [RightEdge] - [Padding] - [TextWidth] - [IconSize] - [SmallGap]
    const iconX = width - padding - approxPhoneWidth - iconSize - (padding * 0.5);
    
    // Position of Vertical Divider: Left of Icon with some spacing
    const dividerX = iconX - (padding * 1.5);
    const dividerHeight = footerHeight * 0.6;
    const dividerY = (footerHeight - dividerHeight) / 2;

    // Construct SVG
    const footerSvg = `
      <svg width="${width}" height="${footerHeight}">
        <line x1="0" y1="0" x2="${width}" y2="0" style="stroke:${borderColor};stroke-width:2" />

        <line x1="${dividerX}" y1="${dividerY}" x2="${dividerX}" y2="${dividerY + dividerHeight}" style="stroke:${dividerColor};stroke-width:2" />

        <text 
            x="${textStartX}" 
            y="${footerHeight / 2 + (fontSizeName / 3)}" 
            font-family="Arial, Helvetica, sans-serif" 
            font-size="${fontSizeName}" 
            fill="${primaryTextColor}" 
            font-weight="800"
            style="text-transform: uppercase; letter-spacing: 0.5px;"
        >
          ${agentProfile.business_name || 'Agent'}
        </text>
        
        <g transform="translate(${iconX}, ${(footerHeight - iconSize) / 2}) scale(${iconSize / 24})">
            <path 
                d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.05 12.05 0 0 0 .57 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.03 12.03 0 0 0 2.81.57A2 2 0 0 1 22 16.92z" 
                fill="${secondaryTextColor}" 
            />
        </g>

        <text 
            x="${width - padding}" 
            y="${footerHeight / 2 + (fontSizePhone / 3)}" 
            font-family="Arial, Helvetica, sans-serif" 
            font-size="${fontSizePhone}" 
            fill="${secondaryTextColor}" 
            font-weight="bold" 
            text-anchor="end"
        >
          ${phoneText}
        </text>
      </svg>
    `
    const footerBuffer = Buffer.from(footerSvg)

    // Extend the canvas with the White Background
    const extendedImage = await sharp(masterBuffer)
        .extend({
            bottom: footerHeight,
            background: backgroundColor
        })

    // Define Layers
    const layers: sharp.OverlayOptions[] = [
      { input: footerBuffer, top: height, left: 0 }
    ]

    if (logoBuffer) {
      const logoTop = height + Math.round((footerHeight - logoSize) / 2)
      layers.push({ input: logoBuffer as any, top: logoTop, left: padding })
    }

    // --- COMPOSITE & COMPRESSION ---
    const finalImageBuffer = await extendedImage
      .composite(layers)
      .jpeg({ quality: 95, mozjpeg: true }) 
      .toBuffer()

    // 5. Upload to Cloudflare R2
    const fileName = `stamped/${user.id}/${Date.now()}.jpg`
    
    try {
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: fileName,
        Body: finalImageBuffer,
        ContentType: 'image/jpeg'
      }))
    } catch (uploadError) {
      console.error("R2 Upload Failed:", uploadError)
      throw new Error("Failed to save image to storage")
    }

    const publicUrl = `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`

    // 6. Save to DB
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