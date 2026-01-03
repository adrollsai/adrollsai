import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'
import path from 'path'
import process from 'process'
import fs from 'fs'
import { checkAndNotifyRivalry, sendNotification } from '@/utils/notification-helper'

// --- FIX: Initialize Fontconfig ---
function initFonts() {
  try {
    // If already set, skip (prevents resetting on warm lambdas)
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
        console.log("✅ Font Config Loaded from:", fontDir);
    } else {
        console.error("❌ Could not find fonts.conf. Searched:", searchPaths);
    }
  } catch (error) {
    console.error("Error initializing fonts:", error);
  }
}

export async function POST(request: Request) {
  // Initialize fonts immediately
  initFonts();

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

    // --- GAMIFICATION & NOTIFICATION LOGIC START ---
    const currentStats = agentProfile 
    
    // Dates Setup
    const now = new Date()
    const todayStr = now.toDateString()
    const lastActivityDate = currentStats?.last_activity_date ? new Date(currentStats.last_activity_date) : null
    const lastActivityStr = lastActivityDate ? lastActivityDate.toDateString() : null
    
    let newStreak = currentStats?.current_streak || 0
    const oldXp = currentStats?.total_xp || 0
    let newXp = oldXp + 50 
    let currentBadges = currentStats?.badges || []
    let newBadges: string[] = [...currentBadges]
    let earnedBadgeName: string | null = null
    
    // STREAK RESET LOGIC
    if (lastActivityStr === todayStr) {
        // Already active today, do nothing to streak
        newStreak = newStreak
    } else {
        // Check if active yesterday
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        
        if (lastActivityStr === yesterday.toDateString()) {
            newStreak += 1 // Streak continues
        } else {
            newStreak = 1 // Streak broken, reset to 1
        }
    }

    // MILESTONES CHECK
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
        
        // Notify user of new badge
        await sendNotification(
            supabase, 
            user.id, 
            "🏆 Badge Unlocked!", 
            `You earned the '${milestone.name}' badge and +${milestone.xp} XP!`, 
            'system'
        )
    }

    const newLevel = Math.floor(newXp / 1000) + 1

    // RIVALRY CHECK (Notify if they beat someone)
    await checkAndNotifyRivalry(supabase, user.id, oldXp, newXp)

    // Update DB
    await supabase.from('profiles').update({
        current_streak: newStreak,
        last_activity_date: new Date().toISOString(),
        total_xp: newXp,
        level: newLevel,
        badges: newBadges
    }).eq('id', user.id)
    // --- GAMIFICATION LOGIC END ---

    // 3. Fetch Master Image
    const masterImageRes = await fetch(masterImageUrl)
    const masterArrayBuffer = await masterImageRes.arrayBuffer()
    const originalBuffer = Buffer.from(masterArrayBuffer) 

    // 4. OPTIMIZATION: Resize to Standard 1080px Width
    const STANDARD_WIDTH = 1080;
    
    const resizedImage = await sharp(originalBuffer)
        .resize(STANDARD_WIDTH, null, { 
            withoutEnlargement: true 
        })
        .toBuffer({ resolveWithObject: true }); 
    
    const optimizedBuffer = resizedImage.data; 
    const { width, height } = resizedImage.info;

    // 5. Calculate Footer Dimensions
    const footerHeight = Math.round(width * 0.15) 
    const padding = Math.round(footerHeight * 0.15)
    const logoSize = Math.round(footerHeight * 0.70)

    // 6. Process Agent Logo
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

    // 7. Define Design Variables
    const primaryTextColor = "#1F2937"; 
    const secondaryTextColor = "#B45309"; 
    const borderColor = "#E5E7EB"; 
    const dividerColor = "#D1D5DB";

    // 8. SVG Construction & Text Wrapping
    const textStartX = logoBuffer ? (padding * 2 + logoSize) : padding
    const fontSizeName = Math.round(footerHeight * 0.28)
    const fontSizePhone = Math.round(footerHeight * 0.28)
    const iconSize = fontSizePhone;
    
    const phoneText = agentProfile.contact_number || 'Contact Me';
    const businessName = agentProfile.business_name || 'Real Estate Agent';

    // --- Right Side Layout (Phone) ---
    const approxPhoneWidth = phoneText.length * (fontSizePhone * 0.6); 
    const iconX = width - padding - approxPhoneWidth - iconSize - (padding * 0.5);
    const dividerX = iconX - (padding * 1.5);
    
    // --- Left Side Layout (Name) ---
    // Calculate available width for the name
    const rightBoundary = agentProfile.contact_number ? dividerX : (width - padding);
    const availableWidth = rightBoundary - textStartX - padding;
    
    // Estimate max chars that fit in one line
    const avgCharWidth = fontSizeName * 0.55; 
    const maxChars = Math.floor(availableWidth / avgCharWidth);

    // --- Text Wrapping Logic ---
    const words = businessName.split(' ');
    let lines: string[] = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        // Check if adding next word exceeds maxChars
        if ((currentLine + " " + words[i]).length <= maxChars) {
            currentLine += " " + words[i];
        } else {
            lines.push(currentLine);
            currentLine = words[i];
        }
    }
    lines.push(currentLine);

    // Safety: Limit to 2 lines max to avoid overflow
    if (lines.length > 2) {
        lines[1] = lines.slice(1).join(" ");
        lines = lines.slice(0, 2);
    }

    // --- Generate Name SVG ---
    let nameSvg = '';
    const lineHeight = fontSizeName * 1.15;

    if (lines.length === 1) {
        // Single Line: Centered vertically
        nameSvg = `<text 
            x="${textStartX}" 
            y="${footerHeight / 2 + (fontSizeName / 3)}" 
            font-family="Poppins" 
            font-size="${fontSizeName}" 
            fill="${primaryTextColor}" 
            font-weight="800"
            style="text-transform: uppercase; letter-spacing: 0.5px;"
        >
          ${lines[0]}
        </text>`;
    } else {
        // Two Lines: Stacked and Centered
        const totalTextHeight = lines.length * lineHeight;
        const startY = (footerHeight - totalTextHeight) / 2 + (fontSizeName * 0.8);
        
        lines.forEach((line, index) => {
            nameSvg += `<text 
                x="${textStartX}" 
                y="${startY + (index * lineHeight)}" 
                font-family="Poppins" 
                font-size="${fontSizeName}" 
                fill="${primaryTextColor}" 
                font-weight="800"
                style="text-transform: uppercase; letter-spacing: 0.5px;"
            >
              ${line}
            </text>`;
        });
    }

    const footerSvg = `
      <svg width="${width}" height="${footerHeight}">
        <line x1="0" y1="0" x2="${width}" y2="0" style="stroke:${borderColor};stroke-width:2" />

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
    const footerBuffer = Buffer.from(footerSvg)

    // 9. Composite (Using optimizedBuffer)
    const extendedImage = await sharp(optimizedBuffer) 
        .extend({
            bottom: footerHeight,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        })

    const layers: sharp.OverlayOptions[] = [
      { input: footerBuffer, top: height, left: 0 }
    ]

    if (logoBuffer) {
      const logoTop = height + Math.round((footerHeight - logoSize) / 2)
      layers.push({ input: logoBuffer as any, top: logoTop, left: padding })
    }

    const finalImageBuffer = await extendedImage
      .composite(layers)
      .jpeg({ quality: 90 }) 
      .toBuffer()

    // 10. Upload
    const fileName = `stamped/${user.id}/${Date.now()}.jpg`
    
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: fileName,
        Body: finalImageBuffer,
        ContentType: 'image/jpeg'
    }))

    const publicUrl = `${R2_PUBLIC_URL}/adrolls-storage/${fileName}`

    // 11. Save to DB
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
        xpEarned: newXp - oldXp,
        streak: newStreak,
        newBadge: earnedBadgeName 
    })

  } catch (error: any) {
    console.error("Stamping Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}