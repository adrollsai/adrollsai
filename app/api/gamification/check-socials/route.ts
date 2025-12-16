// adrollsai/adrollsai/adrollsai-builder-app/app/api/gamification/check-socials/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // 2. Fetch Profile Credentials & Stats
    const { data: profile } = await supabase
      .from('profiles')
      .select('facebook_token, linkedin_token, google_business_token, youtube_token, total_xp, level, badges')
      .eq('id', user.id)
      .single()

    if (!profile) throw new Error("Profile not found")

    // 3. Calculate Connections
    const connections = [
      !!profile.facebook_token,
      !!profile.linkedin_token,
      !!profile.google_business_token,
      !!profile.youtube_token
    ]
    const count = connections.filter(Boolean).length
    
    // Define Milestones
    const milestones = [
        { count: 1, id: 'social_connected', xp: 100, name: 'Connected' },
        { count: 2, id: 'social_networker', xp: 150, name: 'Networker' },
        { count: 3, id: 'social_influencer', xp: 200, name: 'Influencer' },
        { count: 4, id: 'social_king', xp: 500, name: 'Omnichannel King' }
    ]

    let xpGained = 0
    let newBadges: string[] = profile.badges || []
    let newlyEarnedBadges: string[] = []

    // 4. Check for New Achievements
    milestones.forEach(m => {
        if (count >= m.count && !newBadges.includes(m.id)) {
            xpGained += m.xp
            newBadges.push(m.id)
            newlyEarnedBadges.push(m.name)
        }
    })

    // If no new rewards, return early
    if (xpGained === 0) {
        return NextResponse.json({ 
            success: true, 
            xpGained: 0, 
            count,
            percentage: (count / 4) * 100
        })
    }

    // 5. Update Database
    const newTotalXp = (profile.total_xp || 0) + xpGained
    const newLevel = Math.floor(newTotalXp / 1000) + 1

    await supabase.from('profiles').update({
        total_xp: newTotalXp,
        level: newLevel,
        badges: newBadges
    }).eq('id', user.id)

    return NextResponse.json({ 
        success: true, 
        xpGained, 
        newLevel,
        earnedBadges: newlyEarnedBadges,
        count,
        percentage: (count / 4) * 100
    })

  } catch (error: any) {
    console.error("Social Check Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}