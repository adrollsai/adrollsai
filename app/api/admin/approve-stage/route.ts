// adrollsai/adrollsai/adrollsai-builder-app-reward-system/app/api/admin/approve-stage/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendNotification } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Admin Role Check
  const { data: admin } = await supabase.from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (admin?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { leadId, approved, xpReward } = await request.json()

  try {
    // 3. Fetch Lead to identify Agent
    const { data: lead } = await supabase.from('leads').select('user_id, pipeline_stage, name').eq('id', leadId).single()
    if (!lead) throw new Error("Lead not found")

    if (approved) {
        // A. Update Lead Status to Active (or Verified)
        await supabase.from('leads').update({ status: 'Active' }).eq('id', leadId)

        // B. Award XP to Agent
        if (lead.user_id && xpReward > 0) {
            const { data: agent } = await supabase.from('profiles').select('total_xp').eq('id', lead.user_id).single()
            const newTotal = (agent?.total_xp || 0) + xpReward
            
            await supabase.from('profiles').update({ total_xp: newTotal }).eq('id', lead.user_id)

            // C. Notify Agent
            await sendNotification(
                supabase,
                lead.user_id,
                "✅ Request Approved!",
                `Lead '${lead.name}' verified for ${lead.pipeline_stage}. You earned +${xpReward} XP!`,
                'system'
            )
        }
    } else {
        // REJECT LOGIC
        // Revert to 'Qualified' or just mark as 'Active' but stay in stage? 
        // Prompt says "pending for approval... when approved... xp".
        // If rejected, usually we revert the stage change or mark it as disqualified. 
        // Let's Revert to 'Qualified' for safety.
        await supabase.from('leads').update({ status: 'Active', pipeline_stage: 'Qualified' }).eq('id', leadId)

        if (lead.user_id) {
            await sendNotification(
                supabase,
                lead.user_id,
                "⚠️ Request Rejected",
                `Update for lead '${lead.name}' was rejected by admin.`,
                'system'
            )
        }
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}