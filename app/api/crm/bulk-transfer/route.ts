import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { leadIds, targetAgentId, deleteHistory, transferWithScheduledActions } = body

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'No leads selected for transfer.' }, { status: 400 })
    }
    if (!targetAgentId) {
      return NextResponse.json({ error: 'Target team member is required.' }, { status: 400 })
    }

    // Get target agent profile for log
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, email, full_name')
      .eq('id', targetAgentId)
      .single()

    const agentName = targetProfile?.business_name || targetProfile?.full_name || targetProfile?.email || 'Teammate'

    // Get transferrer profile
    const { data: senderProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, email, full_name')
      .eq('id', user.id)
      .single()

    const senderName = senderProfile?.business_name || senderProfile?.full_name || senderProfile?.email || 'Admin'

    if (deleteHistory) {
      // 1. Delete all past history logs for transferred leads
      const { error: historyErr } = await supabaseAdmin
        .from('lead_history')
        .delete()
        .in('lead_id', leadIds)

      if (historyErr) {
        console.error('[Bulk Transfer] Error deleting history:', historyErr)
      }

      // 2. Build payload for reset + reassignment
      const updatePayload: any = {
        assigned_to: targetAgentId,
        status: 'New Lead',
        pipeline_stage: 'New Lead'
      }

      if (!transferWithScheduledActions) {
        updatePayload.next_followup = null
      }

      const { error: leadUpdateErr } = await supabaseAdmin
        .from('leads')
        .update(updatePayload)
        .in('id', leadIds)

      if (leadUpdateErr) {
        throw new Error(leadUpdateErr.message)
      }

      // 3. Log initial fresh transfer history entry
      const historyEntries = leadIds.map(leadId => ({
        lead_id: leadId,
        user_id: user.id,
        action_type: 'TRANSFER',
        description: `🔄 Lead transferred from ${senderName} to ${agentName} (History Reset & Moved to New Lead)`
      }))

      await supabaseAdmin.from('lead_history').insert(historyEntries)

    } else {
      // Keep history, update assignment
      const updatePayload: any = {
        assigned_to: targetAgentId
      }

      if (!transferWithScheduledActions) {
        updatePayload.next_followup = null
      }

      const { error: leadUpdateErr } = await supabaseAdmin
        .from('leads')
        .update(updatePayload)
        .in('id', leadIds)

      if (leadUpdateErr) {
        throw new Error(leadUpdateErr.message)
      }

      // Log transfer history entry
      const historyEntries = leadIds.map(leadId => ({
        lead_id: leadId,
        user_id: user.id,
        action_type: 'TRANSFER',
        description: `🔄 Lead transferred from ${senderName} to ${agentName}`
      }))

      await supabaseAdmin.from('lead_history').insert(historyEntries)
    }

    return NextResponse.json({
      success: true,
      transferredCount: leadIds.length,
      targetAgentName: agentName
    })

  } catch (error: any) {
    console.error('[Bulk Transfer API Error]:', error)
    return NextResponse.json({ error: error.message || 'Server error during transfer' }, { status: 500 })
  }
}
