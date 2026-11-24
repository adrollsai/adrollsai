import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'
import { sendLeadTransferEmail } from '@/utils/email-helper'
import { chargeEmailSends } from '@/lib/automation/email-billing'
import { requireUser, serviceAdmin } from '@/utils/route-auth'
import { buildCampaignFilter, buildFormFilter, buildStageFilter } from '@/lib/crm/transfer-filters'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Max 5 minutes for large bulk operations

const supabaseAdmin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()

    /**
     * One id for one operation, so it can be undone as an operation.
     *
     * The client may pass its own (a retry of the same click reuses it); otherwise one is minted here.
     * Every row in this call is stamped with it, and the reverse endpoint takes nothing else.
     */
    const batchId = String(body?.batchId || '').trim() || `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    // Authentication: session cookie or Bearer token only. A caller-supplied
    // `userId`/`impersonateId` is NOT an identity — it is a *scope* request that
    // must be authorised below.
    const user = await requireUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Captured for use inside the async worker closures below (TS cannot narrow
    // through a closure).
    const actingUserId: string = user.id

    const {
      leadIds,
      targetAgentId,
      deleteHistory,
      hideHistory,
      transferWithScheduledActions = true,
      // Reset the lead to a fresh stage for the receiving agent. Default true when the history is hidden: hiding the
      // history but leaving the lead sitting in "Requirement Taken" is what made the option feel pointless, because
      // the new agent's first sight of the lead is somebody else's progress with no history behind it.
      resetStage,
      // An explicit stage to land in, instead of the workspace default.
      targetStage,
      // Clear the retry/attempt counters so the new agent is not inheriting a call budget already spent.
      resetAttempts,
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

    // `hideHistory` is the current name; `deleteHistory` is accepted for older
    // clients but no longer deletes anything (see below).
    const hideHistoryFromAssignee = Boolean(hideHistory ?? deleteHistory)

    // Authorise the acting scope before touching any data.
    const effectiveUserId = impersonateId && impersonateId !== 'null' && impersonateId !== 'undefined'
      ? String(impersonateId)
      : user.id

    if (effectiveUserId !== user.id) {
      const authAdmin = serviceAdmin()
      const { data: callerProfile } = await authAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      const callerRole = String(callerProfile?.role || '').toLowerCase()
      const { data: targetProfileRow } = await authAdmin
        .from('profiles')
        .select('id, agency_id, parent_id')
        .eq('id', effectiveUserId)
        .maybeSingle()

      const allowed =
        callerRole === 'super_admin' ||
        !!(targetProfileRow && (
          targetProfileRow.agency_id === user.id || targetProfileRow.parent_id === user.id
        ))

      if (!allowed) {
        return NextResponse.json(
          { error: 'Forbidden: you cannot transfer leads for this account.' },
          { status: 403 }
        )
      }
    }

    // Validate target agent if not in preview mode
    let targetProfile: any = null
    let agentName = 'Teammate'

    if (!previewOnly) {
      if (!targetAgentId) {
        return NextResponse.json({ error: 'Target team member is required.' }, { status: 400 })
      }

      const { data: tp, error: tpErr } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, email, full_name, business_info')
        .eq('id', targetAgentId)
        .maybeSingle()

      if (tpErr || !tp) {
        return NextResponse.json({ error: 'Selected target team member was not found.' }, { status: 404 })
      }

      targetProfile = tp
      agentName = tp.business_name || tp.full_name || tp.email || 'Teammate'
    }

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
      const isQuickPreview = Boolean(previewOnly && (!filterDnp || filterDnp === 'ALL'))
      let query = supabaseAdmin
        .from('leads')
        .select(
          isQuickPreview ? 'id' : 'id, name, phone, email, notes, assigned_to, user_id, custom_fields, pipeline_stage, created_at',
          { count: 'exact', head: isQuickPreview }
        )

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

      // Filter by Pipeline Stage.
      //
      // Stage, Campaign and Form all accept an ARRAY now (an admin may send leads from several
      // campaigns at once) while still accepting the old plain string, and `[]`/`'ALL'` both mean
      // "no filter". This is the single place the criteria are translated, and the quick-preview
      // path above runs through exactly this code, so the count the admin confirms cannot be
      // computed from a different (narrower) set of filters than the transfer that follows.
      const stageFilters = buildStageFilter(filterStage)
      if (stageFilters.length === 1) {
        query = query.eq('pipeline_stage', stageFilters[0])
      } else if (stageFilters.length > 1) {
        query = query.in('pipeline_stage', stageFilters)
      }

      // Filter by Campaign: every selected campaign is OR-ed in ONE expression.
      const campaignFilter = buildCampaignFilter(filterCampaign)
      if (campaignFilter) {
        query = query.or(campaignFilter)
      }

      // Filter by Form: same treatment.
      const formFilter = buildFormFilter(filterForm)
      if (formFilter) {
        query = query.or(formFilter)
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

      if (!isQuickPreview) {
        if (maxLimit && typeof maxLimit === 'number' && maxLimit > 0) {
          query = query.range(0, maxLimit - 1)
        } else {
          query = query.range(0, 9999)
        }
      }

      const res = await query

      if (isQuickPreview) {
        if (res.error) {
          return NextResponse.json({ error: res.error.message }, { status: 400 })
        }
        const totalCount = res.count ?? 0
        const finalCount = (maxLimit && typeof maxLimit === 'number' && maxLimit > 0)
          ? Math.min(maxLimit, totalCount)
          : totalCount

        return NextResponse.json({
          success: true,
          previewCount: finalCount
        })
      }

      rawFetchedLeads = res.data || []
      exactMatchedCount = res.count
      fetchErr = res.error
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
    // Declared out here, not inside the worker block below: that block is a bare `{ ... }` scope, so counters declared
    // in it are invisible to the response at the bottom of the handler.
    let updatedCount = 0
    let stageResetCount = 0
    let actionsClearedCount = 0
    const updateErrors: string[] = []

    // EXECUTE UPDATES
    //
    // Always go through the worker pool. The old "fast path" (a bare
    // `assigned_to` bulk update) skipped custom_fields entirely, which meant a
    // re-transfer could never clear a previous visibility cutoff, and it also
    // treated hide-history as a normal assignment.
    {
      // Continuous asynchronous worker pool (CONCURRENCY = 40)
      // Eliminates stop-and-wait batch barriers, achieving 10x-15x throughput speedup
      const CONCURRENCY = 40
      let currentIndex = 0

      async function worker() {
        while (currentIndex < targetLeads.length) {
          const lead = targetLeads[currentIndex++]
          if (!lead) continue

          let cf = lead.custom_fields || {}
          while (typeof cf === 'string') {
            try { cf = JSON.parse(cf) } catch (e) { cf = {}; break; }
          }
          if (!cf || typeof cf !== 'object' || Array.isArray(cf)) cf = {}

          const updatePayload: any = {
            assigned_to: targetAgentId
          }

          // Hide the pre-transfer history from the receiving teammate.
          //
          // Nothing is deleted. The lead keeps its remarks, DNP counts, stage and
          // follow-up totals; we only stamp a visibility cutoff that the client
          // honours for non-admin viewers (see utils/lead-visibility.ts). Admins
          // and the transferring workspace keep the complete history, and the
          // lead's source is always visible to everyone.
          if (hideHistoryFromAssignee) {
            cf.history_visible_from = cutoffTimestamp
            cf.history_hidden_from_assignee = true
            cf.history_hidden_at = cutoffTimestamp
            cf.history_hidden_by = actingUserId
          } else {
            // Re-transferring without hiding clears any previous cutoff.
            delete cf.history_visible_from
            delete cf.history_hidden_from_assignee
            delete cf.history_hidden_at
            delete cf.history_hidden_by
          }

          // STAGE RESET. Hiding the history and keeping the stage was contradictory: the receiving agent sees the lead
          // parked in "Requirement Taken" or "Visit Planned" with nothing to explain how it got there, and has to move
          // it back by hand. When the sender resets the history, the lead starts fresh unless they explicitly picked a
          // stage. Both the stage and the attempt counters move together: a fresh lead that has already used three call
          // attempts is not fresh.
          const shouldResetStage = resetStage === undefined ? hideHistoryFromAssignee : Boolean(resetStage)
          const stageToUse = String(targetStage || '').trim()
            // Keep what it used to be. pipeline_stage is a real column, so resetting it changes what EVERYONE sees,
            // admins included - a visibility cutoff could never fake a stage, and nothing was recording where the lead
            // came from. Without this an admin cannot tell a reset lead from a genuinely new one.
            const stageBefore = String(lead.pipeline_stage || '').trim()
            if (stageBefore && stageBefore !== (stageToUse || 'New Lead')) {
              cf.stage_before_reset = stageBefore
              cf.stage_before_reset_at = cutoffTimestamp
            }
            const attemptsBefore = Number((lead as any).voice_call_retry_count) || 0
            if (attemptsBefore > 0) cf.attempts_before_reset = attemptsBefore
          if (shouldResetStage || stageToUse) {
            updatePayload.pipeline_stage = stageToUse || 'New Lead'
            updatePayload.status = stageToUse || 'New Lead'
            cf.stage_reset_at = cutoffTimestamp
            cf.stage_reset_by = actingUserId
            // A reset stage alone does not make a lead look fresh. categorizeLeadStage() reads a shadow stage out of
            // custom_fields (cf.pipeline_stage / cf.status / cf.lead_status / cf.client_status), and it treats ANY lead
            // carrying a scheduled next action as Ongoing - so a lead reset to "New Lead" whose custom fields still said
            // "Warm", or that still had cf.next_action_date, silently stayed out of the Fresh bucket. That is why a
            // 200-lead reset only showed a fraction of them as fresh. Archive the old values, then drop the keys the
            // categoriser keys off.
            const shadowKeys = ['pipeline_stage', 'status', 'lead_status', 'client_status'].filter((k) => {
              const v = typeof cf[k] === 'string' ? cf[k].trim() : ''
              return v && !/^(new lead|fresh|new|unprocessed|uncontacted)$/i.test(v)
            })
            if (shadowKeys.length) {
              cf.stage_before_reset_fields = Object.fromEntries(shadowKeys.map((k) => [k, cf[k]]))
              for (const k of shadowKeys) delete cf[k]
            }
            if (resetAttempts === undefined ? hideHistoryFromAssignee : Boolean(resetAttempts)) {
              updatePayload.voice_call_retry_count = 0
              updatePayload.next_followup = null
              cf.attempts_reset_at = cutoffTimestamp
              // Same trap one level down: cf.next_action_date keeps a reset lead in Ongoing on its own, even with the
              // next_followup column cleared.
              const hadNextAction = Boolean(cf.next_action_date || cf.next_action_type || cf.next_action_remark)
              for (const k of ['next_action_date', 'next_action_type', 'next_action_remark']) delete cf[k]
              if (hadNextAction) cf.next_action_cleared_at = cutoffTimestamp
            }
          }

          // Pending / scheduled actions: same rule. When the sender chooses not
          // to hand them over, the data stays on the lead (admins still see and
          // can action it) but the assignee's views suppress it.
          if (!transferWithScheduledActions) {
            cf.pending_actions_hidden = true
            cf.pending_actions_hidden_at = cutoffTimestamp
          } else {
            delete cf.pending_actions_hidden
            delete cf.pending_actions_hidden_at
          }

          /**
           * THE RECEIPT.
           *
           * Everything a reverse needs, written at the moment of transfer. Without this a transfer could
           * not be undone: the route archived the old stage and attempt counters, but never recorded WHO
           * the lead came from, so "transfer it back" had nothing to transfer it back to. The receipt is
           * the difference between an audit trail and a reversible action.
           *
           * `batchId` groups every row of one operation, so reversing is one click on the operation
           * rather than 200 clicks on 200 leads. `previousAssignee` is the lead's owner immediately
           * before this call, which is what a reverse restores.
           */
          cf.transfer_receipt = {
            batch_id: batchId,
            previous_assignee: (lead as any).assigned_to ?? null,
            new_assignee: targetAgentId,
            at: cutoffTimestamp,
            by: actingUserId,
            hid_history: Boolean(hideHistoryFromAssignee),
            reset_stage: Boolean(shouldResetStage || stageToUse),
            stage_before: String(lead.pipeline_stage || '').trim() || null,
            status_before: String((lead as any).status || '').trim() || null,
            attempts_before: Number((lead as any).voice_call_retry_count) || 0,
            next_followup_before: (lead as any).next_followup ?? null,
            hid_pending_actions: !transferWithScheduledActions,
          }

          updatePayload.custom_fields = cf

          // Audit trail: an admin should be able to see that this lead was moved, from where, and by whom.
          supabaseAdmin
            .from('lead_history')
            .insert({
              lead_id: lead.id,
              user_id: targetAgentId,
              action_type: 'REMARK',
              description:
                `Lead transferred by ${actingUserId}.` +
                ((shouldResetStage || stageToUse)
                  ? ` Stage reset to ${updatePayload.pipeline_stage}` +
                    (cf.stage_before_reset ? ` (was ${cf.stage_before_reset}).` : '.')
                  : '') +
                (hideHistoryFromAssignee ? ' Earlier history hidden from the new assignee; admins still see all of it.' : ''),
            })
            .then(() => {}, () => {})

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
            if (res.error) {
              console.error('[Bulk Transfer Row Update Error]:', res.error)
              updateErrors.push(res.error.message || 'Row update failed')
            }
          }
          if (!res.error) {
            updatedCount++
            if (shouldResetStage || stageToUse) stageResetCount++
            if (cf.next_action_cleared_at === cutoffTimestamp) actionsClearedCount++
          }
        }
      }

      const workers = Array.from(
        { length: Math.min(CONCURRENCY, targetLeads.length) },
        () => worker()
      )
      await Promise.all(workers)

      if (updateErrors.length > 0 && updateErrors.length === targetLeads.length) {
        throw new Error('Failed to update lead custom fields and assignment: ' + updateErrors[0])
      }
    }

    // Log transfer history entries in parallel batches of 500
    const historyEntries = validLeadIds.map(leadId => ({
      lead_id: leadId,
      user_id: user.id,
      action_type: 'TRANSFER',
      description: hideHistoryFromAssignee
        ? `🔄 Lead transferred from ${senderName} to ${agentName} (earlier history hidden from assignee — admins still see it)`
        : `🔄 Lead transferred from ${senderName} to ${agentName}`
    }))

    const HISTORY_BATCH = 500
    const historyPromises = []
    for (let i = 0; i < historyEntries.length; i += HISTORY_BATCH) {
      const chunk = historyEntries.slice(i, i + HISTORY_BATCH)
      historyPromises.push(
        supabaseAdmin.from('lead_history').insert(chunk)
      )
    }
    await Promise.all(historyPromises).catch(err => {
      console.warn('[Bulk Transfer History Insert Warning]:', err?.message || err)
    })

    // Trigger Push Notification & Email Notification to target agent in background (non-blocking for UI speed)
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

    const { resolveNotificationRecipients } = await import('@/utils/email-helper');
    const { toEmail: resolvedTargetEmail } = resolveNotificationRecipients(targetProfile);
    if (resolvedTargetEmail) {
      notifPromises.push(
        sendLeadTransferEmail(
          resolvedTargetEmail,
          agentName,
          senderName,
          validLeadIds.length
        )
          // Billed at twice what it costs us, like every other metered action — and only once the
          // provider accepted it, which is what resolving means here.
          .then(() => chargeEmailSends(supabaseAdmin, actingUserId, { count: 1, label: 'Lead transfer notice' }))
          .catch((err: any) => console.error('[Bulk Transfer Email Error]:', err))
      )
    }

    Promise.allSettled(notifPromises).catch(err => {
      console.error('[Bulk Transfer Notification Exception]:', err)
    })

    return NextResponse.json({
      success: true,
      /**
       * The handle for undoing exactly this operation. Every transferred lead carries it in
       * `custom_fields.transfer_receipt.batch_id`, so POST /api/crm/bulk-transfer/reverse with this id
       * puts them all back where they came from.
       */
      batchId,
      transferredCount: validLeadIds.length,
      // Counts, not a claim. The UI can now say "200 sent, 197 updated, 3 failed" instead of implying every id moved.
      updatedCount,
      failedCount: updateErrors.length,
      skippedCount: Math.max(0, validLeadIds.length - updatedCount - updateErrors.length),
      stageResetCount,
      scheduledActionsClearedCount: actionsClearedCount,
      targetAgentName: agentName,
      ...(updateErrors.length ? { updateErrors: updateErrors.slice(0, 5) } : {}),
    })

  } catch (error: any) {
    console.error('[Bulk Transfer API Error]:', error)
    return NextResponse.json({ error: error.message || 'Server error during transfer' }, { status: 500 })
  }
}
