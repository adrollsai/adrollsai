// adrollsai/adrollsai/adrollsai-builder-app/app/api/crm/create/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

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

    // 3. Gamification: Award XP
    // Fetch current stats to calculate level
    const { data: profile } = await supabase
        .from('profiles')
        .select('total_xp, level')
        .eq('id', user.id)
        .single()
    
    const currentXp = profile?.total_xp || 0
    const xpGained = 50 // Points for adding a manually sourced lead
    const newXp = currentXp + xpGained
    
    // Simple Level Formula: Level up every 1000 XP
    const newLevel = Math.floor(newXp / 1000) + 1

    // Update Profile Stats
    const { error: xpError } = await supabase.from('profiles').update({
        total_xp: newXp,
        level: newLevel,
        last_activity_date: new Date().toISOString() // Also updates "last active" for general tracking
    }).eq('id', user.id)

    if (xpError) {
        console.error("Failed to update XP:", xpError)
        // We don't throw here because the lead was already created successfully.
        // We just return the lead, but maybe without the XP success flag.
    }

    return NextResponse.json({ 
        success: true, 
        lead, 
        xpGained, 
        newLevel,
        leveledUp: newLevel > (profile?.level || 1)
    })

  } catch (error: any) {
    console.error("Create Lead Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}