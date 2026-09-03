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

    // Handle service/fallback auth or impersonation
    if (!user && (body.userId || body.impersonateId)) {
      const targetId = body.impersonateId || body.userId
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

    const {
      leadIds,
      targetAgentId,
      deleteHistory,
      transferWithScheduledActions = true,
      fromAgentIds,
      useFilters,
      filterStage,
      filterDnp,
      filterDateRange,
      filterCampaign,
      filterForm,
      maxLimit,
      previewOnly,
      impersonateId
    } = body

    // Validate target agent if not in preview mode
    let targetProfile: any = null
    let agentName = 'Teammate'

    if (!previewOnly) {
      if (!targetAgentId) {
        return NextResponse.json({ error: 'Target team member is required.' }, { status: 400 })
      }

      const { data: tp, error: tpErr } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, email, full_name')
        .eq('id', targetAgentId)
        .maybeSingle()

      if (tpErr || !tp) {
        return NextResponse.json({ error: 'Selected target team member was not found.' }, { status: 404 })
      }

      targetProfile = tp
      agentName = tp.business_name || tp.full_name || tp.email || 'Teammate'
    }

    // Determine effective workspace user (handle impersonation)
    const effectiveUserId = impersonateId || user.id

    // Get transferrer profile
    const { data: senderProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, email, full_name, agency_id, parent_id, role')
      .eq('id', effectiveUserId)
      .maybeSingle()

    const senderName = senderProfile?.business_name || senderProfile?.full_name || senderProfile?.email || 'Admin'

    let rawFetchedLeads: any[] = []
    let fetchErr: any = null
    let exactMatchedCount: number | null = null

    // PATH 1: Direct Lead IDs provided (Checkbox selection or Selected list)
    if (Array.isArray(leadIds) && leadIds.length > 0 && !useFilters) {
      const uniqueLeadIds = Array.from(new Set(leadIds.filter(Boolean)))
      const batchSize = 200
      const fetchPromises = []

      for (let i = 0; i < uniqueLeadIds.length; i += batchSize) {
        const chunk = uniqueLeadIds.slice(i, i + batchSize)
        fetchPromises.push(
          supabaseAdmin
            .from('leads')
            .select('id, name, phone, email, notes, assigned_to, user_id, custom_fields, pipeline_stage, created_at')
            .in('id', chunk)
            .then(res => {
              if (res.error) console.error('[Bulk Transfer Chunk Fetch Error]:', res.error)
              return res.data || []
            })
        )
      }

      const results = await Promise.all(fetchPromises)
      rawFetchedLeads = results.flat()

      // Filter by From Agent IDs if specified in the selection modal
      if (Array.isArray(fromAgentIds) && fromAgentIds.length > 0 && !fromAgentIds.includes('ALL')) {
        const hasUnassigned = fromAgentIds.includes('UNASSIGNED') || fromAgentIds.includes('unassigned')
        const validAgentUuids = fromAgentIds.filter(id => id && !['ALL', 'UNASSIGNED', 'unassigned'].includes(id))

        rawFetchedLeads = rawFetchedLeads.filter(lead => {
          if (!lead.assigned_to) {
            return hasUnassigned || validAgentUuids.includes(lead.user_id)
          }
          return validAgentUuids.includes(lead.assigned_to) || validAgentUuids.includes(lead.user_id)
        })
      }

      exactMatchedCount = rawFetchedLeads.length
    } else {
      // PATH 2: Filter-based querying
      let query = supabaseAdmin
        .from('leads')
        .select('id, name, phone, email, notes, assigned_to, user_id, custom_fields, pipeline_stage, created_at', { count: 'exact' })

      // Find workspace profiles to scope query
      const workspaceOwnerId = senderProfile?.agency_id || senderProfile?.parent_id || senderProfile?.id || effectiveUserId
      const { data: workspaceProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`id.eq.${workspaceOwnerId},parent_id.eq.${workspaceOwnerId},agency_id.eq.${workspaceOwnerId}`)

      const workspaceIds = Array.from(new Set((workspaceProfiles || []).map(p => p.id)))
      if (workspaceIds.length > 0) {
        query = query.or(`user_id.in.(${workspaceIds.join(',')}),assigned_to.in.(${workspaceIds.join(',')})`)
      } else {
        query = query.eq('user_id', effectiveUserId)
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
        error: fetchErr ? fetchErr.message : 'No leads matched the selected transfer and filter criteria.'
      }, { status: 400 })
    }

    // Apply DNP / Call Filter in-memory if requested
    let targetLeads = rawFetchedLeads
    if (filterDnp && filterDnp !== 'ALL') {
      targetLeads = targetLeads.filter(lead => {
        let cf = lead.custom_fields
        while (typeof cf === 'string') {
          try { cf = JSON.parse(cf) } catch (e) { cf = {}; break; }
        }
        if (!cf || typeof cf !== 'object' || Array.isArray(cf)) cf = {}

        const isDnp = cf?.last_call_dnp === true || (lead.notes && lead.notes.toLowerCase().includes('dnp'))
        if (filterDnp === 'DNP_ONLY') return isDnp
        if (filterDnp === 'NO_DNP') return !isDnp
        if (filterDnp === 'NO_CALLS') return !cf?.last_call_initiated_at && !cf?.last_followup_at
        return true
      })
    }

    // Apply maxLimit guarantee
    if (maxLimit && typeof maxLimit === 'number' && maxLimit > 0) {
      targetLeads = targetLeads.slice(0, maxLimit)
    }

    if (previewOnly) {
      return NextResponse.json({
        success: true,
        previewCount: targetLeads.length
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

    // EXECUTE UPDATES
    if (!deleteHistory && transferWithScheduledActions) {
      // Fast parallel batch update: update assigned_to in chunks of 250
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
      const updateResults = await Promise.all(updatePromises)
      for (const res of updateResults) {
        if (res.error) {
          console.error('[Bulk Transfer Batch Update Error]:', res.error)
          throw new Error(res.error.message || 'Failed to update lead assignments')
        }
      }
    } else {
      // Row updates in safe parallel groups of 25 with retry
      const PARALLEL_GROUP = 25
      for (let i = 0; i < targetLeads.length; i += PARALLEL_GROUP) {
        const group = targetLeads.slice(i, i + PARALLEL_GROUP)
        const results = await Promise.all(group.map(async lead => {
          let cf = lead.custom_fields || {}
          while (typeof cf === 'string') {
            try { cf = JSON.parse(cf) } catch (e) { cf = {}; break; }
          }
          if (!cf || typeof cf !== 'object' || Array.isArray(cf)) cf = {}

          const updatePayload: any = {
            assigned_to: targetAgentId
          }

          if (deleteHistory) {
            cf.history_visible_from = cutoffTimestamp
            delete cf.last_followup_remark
            delete cf.last_remark
            delete cf.last_call_remark
            delete cf.last_followup_at
            delete cf.last_action_date
            delete cf.last_followup_by
            delete cf.last_call_status
            delete cf.last_call_dnp
            delete cf.dnp_count
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

          let res = await supabaseAdmin
            .from('leads')
            .update(updatePayload)
            .eq('id', lead.id)

          // One retry in case of momentary connection hiccup
          if (res.error) {
            await new Promise(r => setTimeout(r, 100))
            res = await supabaseAdmin
              .from('leads')
              .update(updatePayload)
              .eq('id', lead.id)
          }

          return res
        }))

        for (const res of results) {
          if (res.error) {
            console.error('[Bulk Transfer Row Update Error]:', res.error)
            throw new Error(res.error.message || 'Failed to update lead custom fields and assignment')
          }
        }
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
    const historyResults = await Promise.all(historyPromises)
    for (const res of historyResults) {
      if (res.error) {
        console.warn('[Bulk Transfer History Insert Warning]:', res.error.message)
      }
    }

    // Trigger Push Notification & Email Notification to target agent safely
    try {
      const notifTitle = `🔄 ${validLeadIds.length} Lead(s) Transferred to You!`
      const notifBody = `${senderName} transferred ${validLeadIds.length} lead(s) to your CRM pipeline.`

      const notifPromises: Promise<any>[] = [
        sendPushNotification(
          targetAgentId,
          notifTitle,
          notifBody,
          '/dashboard/crm',
          'lead_transfer'
        ).catch((err: any) => console.error('[Bulk Transfer Push Error]:', err))
      ]

      if (targetProfile?.email) {
        notifPromises.push(
          sendLeadTransferEmail(
            targetProfile.email,
            agentName,
            senderName,
            validLeadIds.length
          ).catch((err: any) => console.error('[Bulk Transfer Email Error]:', err))
        )
      }

      await Promise.allSettled(notifPromises)
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
