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

    // --- COMPRESSION ---
    const finalImageBuffer = await sharp(masterBuffer)
      .composite(layers)
      .jpeg({ quality: 80, mozjpeg: true }) 
      .toBuffer()

    // 4. Upload to Cloudflare R2
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

    return NextResponse.json({ 
        success: true, 
        url: publicUrl, 
        xpEarned: newXp - (currentStats?.total_xp || 0), // Show actual gained XP (Base + Bonus)
        streak: newStreak,
        newBadge: earnedBadgeName // Pass this to frontend to show celebration
    })

  } catch (error: any) {
    console.error("Stamping Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}