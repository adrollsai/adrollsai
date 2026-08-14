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
    const { leadIds, targetAgentId, deleteHistory, transferWithScheduledActions, fromAgentIds, useFilters, filterStage, filterDnp, filterDateRange, filterCampaign, filterForm, maxLimit, previewOnly } = body

    if (!previewOnly && !targetAgentId) {
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
      .select('id, business_name, email, full_name, agency_id, parent_id')
      .eq('id', user.id)
      .single()

    const senderName = senderProfile?.business_name || senderProfile?.full_name || senderProfile?.email || 'Admin'

    let rawFetchedLeads: any[] = []
    let fetchErr: any = null
    let exactMatchedCount: number | null = null

    if (Array.isArray(leadIds) && leadIds.length > 0 && !useFilters) {
      // Chunk leadIds and fetch in parallel
      const batchSize = 200
      const fetchPromises = []
      for (let i = 0; i < leadIds.length; i += batchSize) {
        const chunk = leadIds.slice(i, i + batchSize)
        fetchPromises.push(
          supabaseAdmin
            .from('leads')
            .select('id, name, phone, email, notes, assigned_to, user_id, custom_fields, pipeline_stage, created_at')
            .in('id', chunk)
            .then(res => {
              if (res.error) console.error('[Bulk Transfer Chunk Error]:', res.error)
              return res.data || []
            })
        )
      }
      const results = await Promise.all(fetchPromises)
      rawFetchedLeads = results.flat()
      exactMatchedCount = rawFetchedLeads.length
    } else {
      let query = supabaseAdmin
        .from('leads')
        .select('id, name, phone, email, notes, assigned_to, user_id, custom_fields, pipeline_stage, created_at', { count: 'exact' })

      // Find workspace profiles to scope query
      const workspaceOwnerId = senderProfile?.agency_id || senderProfile?.parent_id || senderProfile?.id || user.id
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
        query = query.range(0, maxLimit - 1)
      } else {
        query = query.range(0, 9999)
      }

      const res = await query
      rawFetchedLeads = res.data || []
      exactMatchedCount = res.count
      fetchErr = res.error
    }

    if (previewOnly && (!filterDnp || filterDnp === 'ALL')) {
      const totalCount = exactMatchedCount ?? (rawFetchedLeads?.length || 0)
      const finalCount = (maxLimit && typeof maxLimit === 'number' && maxLimit > 0)
        ? Math.min(maxLimit, totalCount)
        : totalCount
      
      return NextResponse.json({
        success: true,
        previewCount: finalCount
      })
    }

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
        if (filterDnp === 'NO_CALLS') return !cf?.last_call_initiated_at && !cf?.last_followup_at
        return true
      })
    }

    if (previewOnly) {
      const finalCount = (maxLimit && typeof maxLimit === 'number' && maxLimit > 0)
        ? Math.min(maxLimit, targetLeads.length)
        : targetLeads.length

      return NextResponse.json({
        success: true,
        previewCount: finalCount
      })
    }

    if (targetLeads.length === 0) {
      return NextResponse.json({ 
        error: 'No leads matched the selected DNP / filter criteria.' 
      }, { status: 400 })
    }

    const validLeadIds = targetLeads.map(l => l.id)
    const cutoffTimestamp = new Date().toISOString()
    const BATCH_SIZE = 250

    if (!deleteHistory && transferWithScheduledActions) {
      // Ultra-fast parallel batch update: update assigned_to in chunks of 250
      const updatePromises = []
      for (let i = 0; i < validLeadIds.length; i += BATCH_SIZE) {
        const chunk = validLeadIds.slice(i, i + BATCH_SIZE)
        updatePromises.push(
          supabaseAdmin
            .from('leads')
            .update({ assigned_to: targetAgentId })
            .in('id', chunk)
        )
      }
      await Promise.all(updatePromises)
    } else {
      // Custom field updates in parallel groups of 50
      const PARALLEL_GROUP = 50
      for (let i = 0; i < targetLeads.length; i += PARALLEL_GROUP) {
        const group = targetLeads.slice(i, i + PARALLEL_GROUP)
        await Promise.all(group.map(lead => {
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

          return supabaseAdmin
            .from('leads')
            .update(updatePayload)
            .eq('id', lead.id)
        }))
      }
    }

    // Log transfer history entries in parallel batches of 250
    const historyEntries = validLeadIds.map(leadId => ({
      lead_id: leadId,
      user_id: user.id,
      action_type: 'TRANSFER',
      description: deleteHistory 
        ? `🔄 Lead transferred from ${senderName} to ${agentName} (History Hidden & Moved to New Lead)`
        : `🔄 Lead transferred from ${senderName} to ${agentName}`
    }))

    const historyPromises = []
    for (let i = 0; i < historyEntries.length; i += BATCH_SIZE) {
      const chunk = historyEntries.slice(i, i + BATCH_SIZE)
      historyPromises.push(
        supabaseAdmin.from('lead_history').insert(chunk)
      )
    }
    await Promise.all(historyPromises)

    // Trigger Push Notification & Email Notification to target agent in background
    ;(async () => {
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
    })()

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
