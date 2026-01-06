// adrollsai/adrollsai/adrollsai-builder-app-lander-feed-notifications/app/api/gamification/check-socials/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('facebook_token, linkedin_token, google_business_token, youtube_token, badges')
      .eq('id', user.id)
      .single()

    if (!profile) throw new Error("Profile not found")

    // Count Connections
    const connections = [
      !!profile.facebook_token,
      !!profile.linkedin_token,
      !!profile.google_business_token,
      !!profile.youtube_token
    ]
    const count = connections.filter(Boolean).length
    
    // Only "Connected" badge remains
    const badgeId = 'social_connected'
    let newBadges: string[] = profile.badges || []
    let earnedBadges: string[] = []

    if (count >= 1 && !newBadges.includes(badgeId)) {
        newBadges.push(badgeId)
        earnedBadges.push('Connected')
        
        // Update DB (No XP awarded)
        await supabase.from('profiles').update({ badges: newBadges }).eq('id', user.id)
    }

    return NextResponse.json({ 
        success: true, 
        xpGained: 0, // No XP for connection
        earnedBadges,
        count
    })

  } catch (error: any) {
    console.error("Social Check Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}