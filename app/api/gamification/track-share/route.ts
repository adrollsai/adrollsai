// adrollsai/adrollsai/adrollsai-builder-app-lander-feed-notifications/app/api/gamification/track-share/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendNotification } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // 1. Fetch Profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_streak, last_activity_date, total_xp, level, badges')
      .eq('id', user.id)
      .single()

    if (!profile) throw new Error("Profile not found")

    // 2. Calculate Streak
    const now = new Date()
    const todayStr = now.toDateString()
    const lastActivityDate = profile.last_activity_date ? new Date(profile.last_activity_date) : null
    const lastActivityStr = lastActivityDate ? lastActivityDate.toDateString() : null
    
    let newStreak = profile.current_streak || 0
    let streakUpdated = false

    if (lastActivityStr !== todayStr) {
        streakUpdated = true
        // Check if active yesterday
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        
        if (lastActivityStr === yesterday.toDateString()) {
            newStreak += 1 // Streak continues
        } else {
            newStreak = 1 // Streak broken or started
        }
    }

    // 3. Award XP (50 XP per share)
    const XP_PER_SHARE = 50
    const newXp = (profile.total_xp || 0) + XP_PER_SHARE
    const newLevel = Math.floor(newXp / 1000) + 1

    // 4. Check Streak Milestones (Badges)
    let newBadges: string[] = profile.badges || []
    let earnedBadgeName: string | null = null

    const MILESTONES = [
        { days: 7, id: 'streak_7', xp: 500, name: 'Week Warrior' },
        { days: 30, id: 'streak_30', xp: 2000, name: 'Consistency King' },
        { days: 100, id: 'streak_100', xp: 5000, name: 'Century Club' }
    ]

    // Only check milestones if streak actually increased today
    if (streakUpdated) {
        const milestone = MILESTONES.find(m => m.days === newStreak)
        if (milestone && !newBadges.includes(milestone.id)) {
            newBadges.push(milestone.id)
            // Bonus XP for milestone
            // Note: User said "XP will only be awarded... share... spent... admin". 
            // Usually milestones give bonus XP, I will keep this small bonus or remove if strictly following instructions.
            // keeping it as it's part of the streak system requested to be kept.
            earnedBadgeName = milestone.name
            
            await sendNotification(
                supabase, 
                user.id, 
                "🏆 Badge Unlocked!", 
                `You earned the '${milestone.name}' badge!`, 
                'system'
            )
        }
    }

    // 5. Update Database
    await supabase.from('profiles').update({
        current_streak: newStreak,
        last_activity_date: now.toISOString(),
        total_xp: newXp,
        level: newLevel,
        badges: newBadges
    }).eq('id', user.id)

    return NextResponse.json({ 
        success: true, 
        xpGained: XP_PER_SHARE,
        streak: newStreak,
        newLevel,
        newBadge: earnedBadgeName
    })

  } catch (error: any) {
    console.error("Track Share Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}