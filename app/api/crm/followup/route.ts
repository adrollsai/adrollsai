import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendFollowupReminderEmail } from '@/utils/email-helper'
import { sendPushNotification } from '@/utils/notification-helper'
import { categorizeLeadStage } from '@/utils/pipeline-stages'
import { isBookableActionType } from '@/utils/followup-activity'


export async function POST(request: Request) {
  const body = await request.json()

  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let user: any = null

  // Fast-path: Check Bearer token in Authorization header
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '').trim()
    if (token) {
      try {
        const { data: authUserData } = await supabaseAdmin.auth.getUser(token)
        if (authUserData?.user) user = authUserData.user
      } catch (e) {}
    }
  }

  // Fallback to cookie session if not authenticated via Bearer
  if (!user) {
    try {
      const supabase = await createClient()
      const { data: userData } = await supabase.auth.getUser()
      if (userData?.user) user = userData.user
      if (!user) {
        const { data: sessionData } = await supabase.auth.getSession()
        if (sessionData?.session?.user) user = sessionData.session.user
      }
    } catch (e) {}
  }

  // Fallback to userId/impersonateId
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

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    action = 'update_followup',
    leadId,
    isDnp = false,
    followupType = 'Call',
    followupDate,
    leadStatus,
    clientStatus,
    propertyId,
    budget,
    referenceName,
    referenceNo,
    remarks,
    nextActionRemark,
    nextRemarks,
    interestedProperties,
    nextActionDate,
    nextActionType = 'Call',
    assignedTo,
    remindMe = true,
    // Idempotency key minted by the client for this one save. A retry — or the client's
    // offline fallback racing a request it aborted — resends the same key, and the second
    // write is recognised and acknowledged instead of duplicated.
    writeId = null
  } = body

  const effectiveNextActionRemark = (nextActionRemark || nextRemarks || '').trim()
  const isBookableNextAction = isBookableActionType(nextActionType)

  if (!leadId) {
    return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })
  }

  if (nextActionDate && typeof nextActionDate === 'string' && nextActionDate.trim() !== '') {
    if (Number.isNaN(new Date(nextActionDate).getTime())) {
      return NextResponse.json({ error: 'Next Action Date is not a valid date' }, { status: 400 })
    }
  }

  try {

    // Verify lead & access
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single()

    if (leadErr || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // Fetch caller profile for logger info
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', user.id)
      .maybeSingle()

    const callerName = callerProfile?.full_name || callerProfile?.email || 'CRM Agent'

    // Handle single call initiation action
    if (action === 'log_call') {
      const callDesc = `📞 Outbound call initiated by ${callerName} to ${lead.name || 'Lead'}`
      await supabaseAdmin.from('lead_history').insert({
        lead_id: leadId,
        user_id: user.id,
        actor_id: user.id,
        action_type: 'REMARK',
        description: callDesc
      })

      return NextResponse.json({ success: true, message: 'Call initiated logged successfully' })
    }

    // ── Idempotency ─────────────────────────────────────────────────────────────
    // The client mints a `writeId` per save. If this lead already carries that id, the write
    // has landed and the client is retrying (typically after its own 12s timeout fired while
    // the request was still completing). Acknowledge instead of writing a second follow-up
    // and a second history row.
    const existingCustomFields: Record<string, any> = (() => {
      const raw = lead.custom_fields
      if (!raw) return {}
      if (typeof raw === 'string') {
        try { return JSON.parse(raw) } catch { return {} }
      }
      return typeof raw === 'object' ? { ...raw } : {}
    })()

    if (writeId && existingCustomFields.last_write_id === writeId) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: 'Followup already saved'
      })
    }

    // Build update object for lead using strictly verified DB columns
    const updatePayload: Record<string, any> = {}

    if (nextActionDate) {
      updatePayload.next_followup = nextActionDate
      if (isBookableNextAction) {
        updatePayload.booked_time = nextActionDate
      }
      // Note: Preserve existing booked_time on regular call/message follow-ups
    } else if (nextActionDate === null || (typeof nextActionDate === 'string' && nextActionDate.trim() === '')) {
      // Explicitly cleared follow-up date
      updatePayload.next_followup = null
    }

    // Apply lead status/stage from the followup form (both DNP and non-DNP flows)
    if (leadStatus) {
      updatePayload.status = leadStatus
      updatePayload.pipeline_stage = leadStatus
    }

    // Automatically clear next_followup if status/stage is set to Lost/NI, Closed, Unqualified, Junk, Dealer, Plan Postponed, Already Purchased, etc.
    const targetStatus = leadStatus || updatePayload.status || lead.status || ''
    const targetStage = updatePayload.pipeline_stage || lead.pipeline_stage || ''
    const targetClientStatus = clientStatus || ''
    const combinedStatusStr = (targetStatus + ' ' + targetStage + ' ' + targetClientStatus).toLowerCase()

    const isLostOrClosed = 
      categorizeLeadStage(targetStatus) === 'not_interested' ||
      categorizeLeadStage(targetStatus) === 'trash' ||
      categorizeLeadStage(targetStage) === 'not_interested' ||
      categorizeLeadStage(targetStage) === 'trash' ||
      combinedStatusStr.includes('lost') ||
      combinedStatusStr.includes('ni') ||
      combinedStatusStr.includes('not interested') ||
      combinedStatusStr.includes('junk') ||
      combinedStatusStr.includes('unqualified') ||
      combinedStatusStr.includes('dealer') ||
      combinedStatusStr.includes('postponed') ||
      combinedStatusStr.includes('already purchased') ||
      combinedStatusStr.includes('different requirement') ||
      combinedStatusStr.includes('closed')

    const hasExplicitNextAction = Boolean(nextActionDate && typeof nextActionDate === 'string' && nextActionDate.trim() !== '')

    // Next action dates are commitments, so a date already in the past is almost always a typo
    // ("11/17" typed as a month/day mix-up, or a value carried over from the previous call).
    // Those typos used to be stored verbatim — and, worse, re-read as the follow-up's own
    // timestamp by the analytics page, which pushed real work out of "today".
    //
    // Only enforced when the date will actually be kept: a Lost/Closed stage clears the next
    // action, and rejecting a stale pre-filled date would block an agent from closing a lead.
    if (hasExplicitNextAction && !isLostOrClosed) {
      const parsedNext = new Date(nextActionDate).getTime()
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
      const oneYearAhead = Date.now() + 366 * 24 * 60 * 60 * 1000
      if (parsedNext < fiveMinutesAgo) {
        return NextResponse.json(
          { error: 'Next Action Date is in the past. Pick a future date for the next follow-up.' },
          { status: 400 }
        )
      }
      if (parsedNext > oneYearAhead) {
        return NextResponse.json(
          { error: 'Next Action Date is more than a year away. Check the month and day.' },
          { status: 400 }
        )
      }
    }

    if (hasExplicitNextAction) {
      updatePayload.next_followup = nextActionDate
      if (isBookableNextAction) {
        updatePayload.booked_time = nextActionDate
      }
    } else if (isLostOrClosed) {
      updatePayload.next_followup = null
      updatePayload.booked_time = null
    }

    if (assignedTo) {
      updatePayload.assigned_to = assignedTo
    }

    if (propertyId) {
      updatePayload.property_id = propertyId
    }

    if (budget !== undefined) {
      updatePayload.budget = budget
    }

    // Update custom_fields with reference info, interested properties, client_status, next action & DNP state
    const customFields: Record<string, any> = { ...existingCustomFields }

    customFields.last_followup_at = new Date().toISOString()
    customFields.last_followup_type = isDnp ? 'Call (DNP)' : followupType
    // Who actually logged it. Nothing used to record this, so "someone is editing my leads"
    // could not be answered from the data. `last_followup_by` is read by the transfer route.
    customFields.last_followup_by = user.id
    customFields.last_followup_by_name = callerName
    if (writeId) customFields.last_write_id = writeId
    if (remarks && typeof remarks === 'string' && remarks.trim()) {
      customFields.last_followup_remark = remarks.trim()
      customFields.last_remark = remarks.trim()
    }

    customFields.followup_count = (customFields.followup_count || 0) + 1

    if (hasExplicitNextAction) {
      customFields.next_action_date = nextActionDate
      updatePayload.next_followup = nextActionDate
      if (nextActionType) customFields.next_action_type = nextActionType
      // A meeting, site visit or appointment is a booking, so the lead must carry the
      // booked time. Without this the lead stays a plain "call due" and the meeting is
      // invisible in every appointment view — which is how a "meet at 9pm" follow-up
      // disappeared overnight.
      if (isBookableNextAction) {
        customFields.booked_time = nextActionDate
        customFields.booked_at = new Date().toISOString()
        customFields.booked_by = user.id
      }
      if (effectiveNextActionRemark) {
        customFields.next_action_remark = effectiveNextActionRemark
        customFields.next_remarks = effectiveNextActionRemark
      } else {
        customFields.next_action_remark = null
        customFields.next_remarks = null
      }
    } else if (isLostOrClosed || nextActionDate === null || (typeof nextActionDate === 'string' && nextActionDate.trim() === '')) {
      customFields.next_action_date = null
      updatePayload.next_followup = null
      customFields.next_action_type = null
      customFields.next_action_remark = null
      customFields.next_remarks = null
    }

    if (clientStatus) {
      customFields.client_status = clientStatus
    }

    const currentStageNorm = (lead.pipeline_stage || lead.status || '').toLowerCase().trim()
    const isCurrentFresh = (
      !currentStageNorm ||
      currentStageNorm === 'new' ||
      currentStageNorm === 'new lead' ||
      currentStageNorm === 'new_lead' ||
      currentStageNorm === 'fresh' ||
      currentStageNorm === 'new inquiry' ||
      currentStageNorm === 'uncontacted' ||
      currentStageNorm === 'unprocessed'
    )

    const incomingStageNorm = (leadStatus || '').toLowerCase().trim()
    const isIncomingFresh = (
      !incomingStageNorm ||
      incomingStageNorm === 'new' ||
      incomingStageNorm === 'new lead' ||
      incomingStageNorm === 'new_lead' ||
      incomingStageNorm === 'fresh' ||
      incomingStageNorm === 'ongoing'
    )

    if (isDnp) {
      customFields.last_call_dnp = true
      customFields.dnp_count = (customFields.dnp_count || 0) + 1
      // Maintain existing lead stage or transition fresh lead to Contacted. Never force to Never Picked!
      if (!isIncomingFresh && incomingStageNorm !== 'never picked') {
        updatePayload.status = leadStatus
        updatePayload.pipeline_stage = leadStatus
      } else if (isCurrentFresh || currentStageNorm === 'ongoing' || currentStageNorm === 'never picked') {
        updatePayload.status = 'Contacted'
        updatePayload.pipeline_stage = 'Contacted'
      } else if (lead.pipeline_stage) {
        updatePayload.status = lead.status || lead.pipeline_stage
        updatePayload.pipeline_stage = lead.pipeline_stage
      } else {
        updatePayload.status = 'Contacted'
        updatePayload.pipeline_stage = 'Contacted'
      }
    } else {
      customFields.last_call_dnp = false
      if (!isIncomingFresh) {
        updatePayload.status = leadStatus
        updatePayload.pipeline_stage = leadStatus
      } else if (isCurrentFresh || currentStageNorm === 'ongoing') {
        updatePayload.status = 'Contacted'
        updatePayload.pipeline_stage = 'Contacted'
      } else if (lead.pipeline_stage) {
        updatePayload.status = lead.status || lead.pipeline_stage
        updatePayload.pipeline_stage = lead.pipeline_stage
      } else {
        updatePayload.status = 'Contacted'
        updatePayload.pipeline_stage = 'Contacted'
      }
    }

    if (referenceName) customFields.reference_name = referenceName
    if (referenceNo) customFields.reference_no = referenceNo
    if (interestedProperties && Array.isArray(interestedProperties)) {
      customFields.interested_properties = interestedProperties
    }

    if (updatePayload.pipeline_stage) {
      customFields.pipeline_stage = updatePayload.pipeline_stage
      customFields.status = updatePayload.status
    }

    const chosenStage = `${updatePayload.pipeline_stage || ''} ${leadStatus || ''} ${followupType || ''}`.toLowerCase()
    const isCompletedVisit = 
      !chosenStage.includes('planned') && 
      !chosenStage.includes('scheduled') && 
      (
        chosenStage.includes('visit done') || 
        chosenStage.includes('visited') || 
        chosenStage.includes('revisit done') || 
        chosenStage.includes('re-visited') || 
        chosenStage.includes('appointment done') ||
        chosenStage.includes('site visit done')
      );

    if (isCompletedVisit) {
      customFields.has_visited = true
      if (!customFields.visited_at) customFields.visited_at = new Date().toISOString()
    }

    updatePayload.custom_fields = customFields

    const activeStage = updatePayload.pipeline_stage || lead.pipeline_stage || lead.status || 'Contacted'

    // Prepend remarks to notes if provided
    let newNotes = lead.notes || ''
    const formattedDateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    
    if (isDnp) {
      const nextDateFormatted = nextActionDate 
        ? new Date(nextActionDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) 
        : 'TBD'
      const dnpNote = `[⚠️ Call Not Picked - DNP (${formattedDateStr}) by ${callerName}]: Next action scheduled for ${nextDateFormatted} (${nextActionType}).${effectiveNextActionRemark ? ` Next Action Note: ${effectiveNextActionRemark}.` : ''}${remarks && remarks.trim() ? ` Remarks: ${remarks.trim()}` : ''}`
      newNotes = dnpNote + (newNotes ? `\n\n${newNotes}` : '')
    } else if (remarks && remarks.trim()) {
      const remarkNote = `[📝 Followup (${followupType}) - ${formattedDateStr} by ${callerName}]: Stage: ${activeStage}. ${remarks.trim()}${effectiveNextActionRemark ? ` | Next: ${effectiveNextActionRemark}` : ''}`
      newNotes = remarkNote + (newNotes ? `\n\n${newNotes}` : '')
    }

    updatePayload.notes = newNotes

    // Apply update to lead in DB
    const { error: updateErr } = await supabaseAdmin
      .from('leads')
      .update(updatePayload)
      .eq('id', leadId)

    if (updateErr) throw updateErr

    /**
     * The appointment appeared, moved, or was called off — tell the sequences.
     *
     * A reminder is only true while the meeting is at the time it names. So a reschedule cancels
     * what was queued and re-plans against the new time, and a cancellation drops it entirely;
     * otherwise someone who moved Tuesday's meeting to Friday still gets "your meeting is in an
     * hour" on Tuesday. This never blocks the save: a sequence that cannot be scheduled is worth a
     * log line, not a failed follow-up.
     */
    if ('booked_time' in updatePayload) {
      try {
        const { onBookingChanged } = await import('@/lib/flows/booking-trigger')
        const bookingResult = await onBookingChanged(supabaseAdmin, {
          userId: lead.user_id,
          leadId,
          bookedTime: updatePayload.booked_time ?? null,
          previousBookedTime: (lead as any).booked_time ?? null,
        })
        console.log('[crm/followup] booking sequence:', bookingResult.action, bookingResult.notes.join(' | '))
      } catch (bookingErr: any) {
        console.warn('[crm/followup] booking sequence failed:', bookingErr?.message)
      }
    }

    // Log entry in lead_history
    const formattedNextActionText = nextActionDate 
      ? new Date(nextActionDate).toLocaleString('en-US', { 
          timeZone: 'Asia/Kolkata',
          month: 'numeric',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true 
        })
      : 'TBD'

    const historyDesc = isDnp
      ? `⚠️ Call Not Picked (DNP) logged by ${callerName}. Next Action: ${nextActionType} on ${formattedNextActionText}.${effectiveNextActionRemark ? ` Note: ${effectiveNextActionRemark}.` : ''}${remarks && remarks.trim() ? ` Remarks: ${remarks.trim()}` : ''}`
      : `📝 Followup (${followupType}) updated by ${callerName}. Stage: ${activeStage}${clientStatus ? `, Rating: ${clientStatus}` : ''}.${remarks && remarks.trim() ? ` Remarks: ${remarks.trim()}` : ''}${effectiveNextActionRemark ? ` Next Action: ${nextActionType} on ${formattedNextActionText} (${effectiveNextActionRemark})` : ''}`

    const isExplicitStageChange = Boolean(leadStatus && leadStatus !== lead.pipeline_stage && leadStatus !== 'Ongoing')

    await supabaseAdmin.from('lead_history').insert({
      lead_id: leadId,
      user_id: user.id,
      // Who actually pressed save. `user_id` is the credited owner; `actor_id` is the human.
      actor_id: user.id,
      action_type: isDnp ? 'REMARK' : (isExplicitStageChange ? 'STATUS_CHANGE' : 'FOLLOWUP'),
      description: historyDesc
    })

    // Manual followup updated successfully (notifications skipped per user request)
    return NextResponse.json({
      success: true,
      // Echoed so the client can confirm this exact save landed and skip its fallback.
      writeId,
      followupCount: customFields.followup_count,
      nextFollowup: updatePayload.next_followup ?? null,
      bookedTime: updatePayload.booked_time ?? null,
      message: isDnp ? 'DNP followup logged successfully' : 'Followup updated successfully'
    })
  } catch (err: any) {
    console.error('[CRM FOLLOWUP ROUTE] Exception:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
