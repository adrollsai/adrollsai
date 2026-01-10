// adrollsai/adrollsai/adrollsai-builder-app-lander-feed-notifications/app/api/admin/award-xp/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendNotification } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Admin Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: adminProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (adminProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { agentId, amount } = await request.json()
    const xpAmount = parseInt(amount)

    if (!agentId || isNaN(xpAmount) || xpAmount <= 0) {
        throw new Error("Invalid parameters")
    }

    // 2. Fetch Agent
    const { data: agent } = await supabase.from('profiles').select('total_xp, level').eq('id', agentId).single()
    if (!agent) throw new Error("Agent not found")

    // 3. Update XP & Calculate Level
    const newXp = (agent.total_xp || 0) + xpAmount
    
    // RATCHET MECHANISM: Since XP resets monthly, we ensure Level never drops.
    // Level is now a "High Water Mark".
    const calculatedLevel = Math.floor(newXp / 1000) + 1
    const currentLevel = agent.level || 1
    const finalLevel = Math.max(currentLevel, calculatedLevel)

    await supabase.from('profiles').update({
        total_xp: newXp,
        level: finalLevel
    }).eq('id', agentId)

    // 4. Notify Agent
    await sendNotification(
        supabase,
        agentId,
        "✨ XP Awarded!",
        `Admin has awarded you +${xpAmount} XP. Keep it up!`,
        'system'
    )

    return NextResponse.json({ success: true, newTotal: newXp, newLevel: finalLevel })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}