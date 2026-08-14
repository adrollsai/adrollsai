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
    const body = await req.json()

    const supabase = await createClient()
    let { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) user = session.user
    }

    const authHeader = req.headers.get('Authorization')
    if (!user && authHeader) {
      const token = authHeader.replace('Bearer ', '').trim()
      if (token) {
        const { data: authUserData } = await supabaseAdmin.auth.getUser(token)
        if (authUserData?.user) user = authUserData.user
      }
    }

    if (!user && (body.userId || body.impersonateId)) {
      const targetId = body.userId || body.impersonateId
      const { data: fallbackProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', targetId)
        .maybeSingle()

      if (fallbackProfile) {
        user = { id: fallbackProfile.id } as any
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { leadIds, targetAgentId, deleteHistory, transferWithScheduledActions, fromAgentIds, useFilters, filterStage, filterDnp, filterDateRange, filterCampaign, filterForm, maxLimit } = body

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

    let query = supabaseAdmin
      .from('leads')
      .select('id, name, phone, email, assigned_to, user_id, custom_fields, pipeline_stage, created_at, last_call_at')

    if (Array.isArray(leadIds) && leadIds.length > 0 && !useFilters) {
      query = query.in('id', leadIds)
    } else {
      // Find workspace profiles to scope query
      const workspaceOwnerId = senderProfile?.id || user.id
      const { data: workspaceProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`id.eq.${workspaceOwnerId},parent_id.eq.${workspaceOwnerId},agency_id.eq.${workspaceOwnerId}`)
      
      const workspaceIds = Array.from(new Set((workspaceProfiles || []).map(p => p.id)))
      if (workspaceIds.length > 0) {
        const workspaceOr = workspaceIds.flatMap(id => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',')
        query = query.or(workspaceOr)
      } else {
        query = query.eq('user_id', user.id)
      }

      // Filter by From Agent IDs
      if (Array.isArray(fromAgentIds) && fromAgentIds.length > 0 && !fromAgentIds.includes('ALL')) {
        const hasUnassigned = fromAgentIds.includes('UNASSIGNED') || fromAgentIds.includes('unassigned')
        const validAgentUuids = fromAgentIds.filter(id => id && !['ALL', 'UNASSIGNED', 'unassigned'].includes(id))

        if (hasUnassigned && validAgentUuids.length === 0) {
          query = query.is('assigned_to', null)
        } else if (!hasUnassigned && validAgentUuids.length > 0) {
          query = query.in('assigned_to', validAgentUuids)
        } else if (hasUnassigned && validAgentUuids.length > 0) {
          query = query.or(`assigned_to.is.null,assigned_to.in.(${validAgentUuids.join(',')})`)
        }
      }

      // Filter by Pipeline Stage
      if (filterStage && filterStage !== 'ALL') {
        query = query.eq('pipeline_stage', filterStage)
      }

      // Filter by Campaign
      if (filterCampaign && filterCampaign !== 'ALL') {
        query = query.or(`campaign_id.eq.${filterCampaign},ad_name.ilike.%${filterCampaign}%`)
      }

      // Filter by Form
      if (filterForm && filterForm !== 'ALL') {
        query = query.or(`form_id.eq.${filterForm},form_name.ilike.%${filterForm}%`)
      }

      // Filter by Date Range
      if (filterDateRange && filterDateRange !== 'ALL') {
        const now = new Date()
        if (filterDateRange === 'TODAY') {
          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
          query = query.gte('created_at', startOfDay)
        } else if (filterDateRange === 'LAST_7_DAYS') {
          const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
          query = query.gte('created_at', sevenDaysAgo)
        } else if (filterDateRange === 'LAST_30_DAYS') {
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString()
          query = query.gte('created_at', thirtyDaysAgo)
        }
      }

      if (maxLimit && typeof maxLimit === 'number' && maxLimit > 0) {
        query = query.limit(maxLimit)
      } else {
        query = query.limit(5000)
      }
    }

    const { data: rawFetchedLeads, error: fetchErr } = await query

    if (fetchErr || !rawFetchedLeads || rawFetchedLeads.length === 0) {
      return NextResponse.json({ 
        error: 'No leads matched the selected transfer and filter criteria.' 
      }, { status: 400 })
    }

    let targetLeads = rawFetchedLeads
    if (filterDnp && filterDnp !== 'ALL') {
      targetLeads = targetLeads.filter(lead => {
        let cf = lead.custom_fields
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf) } catch (e) { cf = {} }
        }
        const isDnp = cf?.last_call_dnp === true || (lead.notes && lead.notes.toLowerCase().includes('dnp'))
        if (filterDnp === 'DNP_ONLY') return isDnp
        if (filterDnp === 'NO_DNP') return !isDnp
        if (filterDnp === 'NO_CALLS') return !lead.last_call_at && !cf?.last_followup_at
        return true
      })
    }

    if (targetLeads.length === 0) {
      return NextResponse.json({ 
        error: 'No leads matched the selected DNP / filter criteria.' 
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
