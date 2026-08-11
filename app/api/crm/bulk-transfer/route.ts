import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'
import { sendLeadTransferEmail } from '@/utils/email-helper'

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
    const { leadIds, targetAgentId, deleteHistory, transferWithScheduledActions, fromAgentIds } = body

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'No leads selected for transfer.' }, { status: 400 })
    }
    if (!targetAgentId) {
      return NextResponse.json({ error: 'Target team member is required.' }, { status: 400 })
    }

    // Get target agent profile for log & notification
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

    // Fetch leads to transfer, applying "From Agent" filter if specified
    let query = supabaseAdmin
      .from('leads')
      .select('id, name, phone, email, assigned_to, user_id, custom_fields')
      .in('id', leadIds)

    if (Array.isArray(fromAgentIds) && fromAgentIds.length > 0) {
      const hasUnassigned = fromAgentIds.includes('unassigned')
      const validUuids = fromAgentIds.filter(id => id && id !== 'unassigned')

      const conditions: string[] = []
      if (hasUnassigned) {
        conditions.push(`assigned_to.is.null`)
      }
      if (validUuids.length > 0) {
        conditions.push(`assigned_to.in.(${validUuids.join(',')})`)
        conditions.push(`user_id.in.(${validUuids.join(',')})`)
      }

      if (conditions.length > 0) {
        query = query.or(conditions.join(','))
      }
    }

    const { data: targetLeads, error: fetchErr } = await query

    if (fetchErr || !targetLeads || targetLeads.length === 0) {
      return NextResponse.json({ 
        error: 'No leads matched the selected transfer and "From Agent" criteria.' 
      }, { status: 400 })
    }

    const validLeadIds = targetLeads.map(l => l.id)
    const cutoffTimestamp = new Date().toISOString()

    for (const lead of targetLeads) {
      let cf = lead.custom_fields || {}
      if (typeof cf === 'string') {
        try { cf = JSON.parse(cf) } catch (e) { cf = {} }
      }

      const updatePayload: any = {
        assigned_to: targetAgentId
      }

      if (deleteHistory) {
        cf.history_visible_from = cutoffTimestamp
        updatePayload.status = 'New Lead'
        updatePayload.pipeline_stage = 'New Lead'
      }

      if (!transferWithScheduledActions) {
        updatePayload.next_followup = null
        updatePayload.booked_time = null
        delete cf.next_action_date
        delete cf.next_action_type
        delete cf.next_action_notes
        delete cf.booked_time
        delete cf.last_followup_at
      }

      updatePayload.custom_fields = cf

      await supabaseAdmin
        .from('leads')
        .update(updatePayload)
        .eq('id', lead.id)
    }

    // Log transfer history entries
    const historyEntries = validLeadIds.map(leadId => ({
      lead_id: leadId,
      user_id: user.id,
      action_type: 'TRANSFER',
      description: deleteHistory 
        ? `🔄 Lead transferred from ${senderName} to ${agentName} (History Hidden & Moved to New Lead)`
        : `🔄 Lead transferred from ${senderName} to ${agentName}`
    }))

    await supabaseAdmin.from('lead_history').insert(historyEntries)

    // Trigger Push Notification & Email Notification to target agent
    try {
      const notifTitle = `🔄 ${validLeadIds.length} Lead(s) Transferred to You!`
      const notifBody = `${senderName} transferred ${validLeadIds.length} lead(s) to your CRM pipeline.`
      
      // 1. Send Push Notification
      await sendPushNotification(
        targetAgentId,
        notifTitle,
        notifBody,
        '/dashboard/crm',
        'lead_transfer'
      ).catch((err: any) => console.error('[Bulk Transfer Push Error]:', err))

      // 2. Send Email Notification
      if (targetProfile?.email) {
        await sendLeadTransferEmail(
          targetProfile.email,
          agentName,
          senderName,
          validLeadIds.length
        ).catch((err: any) => console.error('[Bulk Transfer Email Error]:', err))
      }
    } catch (notifErr: any) {
      console.error('[Bulk Transfer Notification Exception]:', notifErr)
    }

    return NextResponse.json({
      success: true,
      transferredCount: validLeadIds.length,
      targetAgentName: agentName
    })

  } catch (error: any) {
    console.error('[Bulk Transfer API Error]:', error)
    return NextResponse.json({ error: error.message || 'Server error during transfer' }, { status: 500 })
  }
}
