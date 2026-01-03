import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { checkAndNotifyRivalry, sendNotification } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const { name, phone, email, notes } = body

    if (!name || !phone) {
        return NextResponse.json({ error: 'Name and Phone are required' }, { status: 400 })
    }

    // 2. Insert Lead
    const { data: lead, error: leadError } = await supabase
        .from('leads')
        .insert({
            user_id: user.id,
            name,
            phone,
            email,
            notes,
            source: 'Manual',
            pipeline_stage: 'New'
        })
        .select()
        .single()

    if (leadError) throw leadError

    // 3. GAMIFICATION & NOTIFICATION LOGIC
    // Fetch current stats
    const { data: profile } = await supabase
        .from('profiles')
        .select('total_xp, level, current_streak, last_activity_date, badges')
        .eq('id', user.id)
        .single()
    
    // Dates Setup
    const now = new Date()
    const todayStr = now.toDateString()
    const lastActivityDate = profile?.last_activity_date ? new Date(profile.last_activity_date) : null
    const lastActivityStr = lastActivityDate ? lastActivityDate.toDateString() : null
    
    let newStreak = profile?.current_streak || 0
    const oldXp = profile?.total_xp || 0
    let newXp = oldXp + 50 // 50 XP for manual lead entry
    
    let currentBadges = profile?.badges || []
    let newBadges: string[] = [...currentBadges]
    let earnedBadgeName: string | null = null

    // STREAK RESET LOGIC
    if (lastActivityStr === todayStr) {
        // Already active today
        newStreak = newStreak
    } else {
        // Check if active yesterday
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        
        if (lastActivityStr === yesterday.toDateString()) {
            newStreak += 1
        } else {
            newStreak = 1 // Reset
        }
    }

    // MILESTONES (Same as stamp logic for consistency)
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
        
        // Notify Badge
        await sendNotification(
            supabase, user.id, "🏆 Badge Unlocked!", `You earned '${milestone.name}' badge!`, 'system'
        )
    }

    const newLevel = Math.floor(newXp / 1000) + 1

    // RIVALRY CHECK
    await checkAndNotifyRivalry(supabase, user.id, oldXp, newXp)

    // ROI NOTIFICATION (Confirm Lead Added)
    await sendNotification(
        supabase, 
        user.id, 
        "✅ Lead Added", 
        `You added ${name} to your pipeline. Call them immediately to increase conversion!`, 
        'roi',
        '/dashboard/crm'
    )

    // Update Profile
    const { error: xpError } = await supabase.from('profiles').update({
        total_xp: newXp,
        level: newLevel,
        current_streak: newStreak,
        badges: newBadges,
        last_activity_date: new Date().toISOString()
    }).eq('id', user.id)

    if (xpError) {
        console.error("Failed to update XP:", xpError)
    }

    return NextResponse.json({ 
        success: true, 
        lead, 
        xpGained: newXp - oldXp, 
        newLevel,
        leveledUp: newLevel > (profile?.level || 1),
        newStreak,
        earnedBadge: earnedBadgeName
    })

  } catch (error: any) {
    console.error("Create Lead Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}