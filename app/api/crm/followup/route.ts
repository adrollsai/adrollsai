import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendFollowupReminderEmail } from '@/utils/email-helper'
import { sendPushNotification } from '@/utils/notification-helper'
import { categorizeLeadStage } from '@/utils/pipeline-stages'

export async function POST(request: Request) {
  const body = await request.json()

  const supabase = await createClient()
  let { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) user = session.user
  }

  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const authHeader = request.headers.get('Authorization')
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
    interestedProperties,
    nextActionDate,
    nextActionType = 'Call',
    assignedTo,
    remindMe = true
  } = body

  if (!leadId) {
    return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })
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
        action_type: 'REMARK',
        description: callDesc
      })

      return NextResponse.json({ success: true, message: 'Call initiated logged successfully' })
    }

    // Build update object for lead using strictly verified DB columns
    const updatePayload: Record<string, any> = {}

    if (nextActionDate) {
      updatePayload.next_followup = nextActionDate
      if (nextActionType === 'Site Visit' || nextActionType === 'Meeting' || nextActionType === 'Appointment') {
        updatePayload.booked_time = nextActionDate
      } else {
        updatePayload.booked_time = null
      }
    } else {
      // When a follow-up is logged without scheduling a future date, previous next action is considered completed/neglected
      updatePayload.next_followup = null
      updatePayload.booked_time = null
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

    if (isLostOrClosed) {
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
    let customFields: Record<string, any> = {}
    if (lead.custom_fields) {
      if (typeof lead.custom_fields === 'string') {
        try { customFields = JSON.parse(lead.custom_fields) } catch (e) {}
      } else if (typeof lead.custom_fields === 'object') {
        customFields = { ...lead.custom_fields }
      }
    }

    customFields.last_followup_at = new Date().toISOString()
    customFields.last_followup_type = followupType
    if (remarks) {
      customFields.last_followup_remark = remarks
      customFields.last_remark = remarks
    } else if (isDnp) {
      customFields.last_followup_remark = remarks || 'Call Not Picked (DNP)'
      customFields.last_remark = remarks || 'Call Not Picked (DNP)'
    }

    if (nextActionDate && !isLostOrClosed) {
      customFields.next_action_date = nextActionDate
      if (nextActionType) customFields.next_action_type = nextActionType
      if (remarks) customFields.next_action_remark = remarks
    } else {
      customFields.next_action_date = null
      customFields.next_action_type = null
      customFields.next_action_remark = null
    }

    if (clientStatus) {
      customFields.client_status = clientStatus
    }

    const currentStage = (lead.pipeline_stage || lead.status || 'New Lead').trim()
    const isCurrentFresh = currentStage === 'New Lead' || currentStage === 'New' || currentStage === 'Fresh'

    if (isDnp) {
      customFields.last_call_dnp = true
      customFields.dnp_count = (customFields.dnp_count || 0) + 1
      if (leadStatus && leadStatus !== 'Ongoing' && leadStatus !== 'New Lead' && leadStatus !== 'New') {
        updatePayload.status = leadStatus
        updatePayload.pipeline_stage = leadStatus
      } else if (isCurrentFresh || currentStage === 'Ongoing') {
        updatePayload.status = 'Never Picked'
        updatePayload.pipeline_stage = 'Never Picked'
      }
    } else {
      customFields.last_call_dnp = false
      if (leadStatus && leadStatus !== 'Ongoing' && leadStatus !== 'New Lead' && leadStatus !== 'New' && leadStatus !== 'Fresh') {
        updatePayload.status = leadStatus
        updatePayload.pipeline_stage = leadStatus
      } else if (isCurrentFresh || currentStage === 'Ongoing') {
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
      const dnpNote = `[⚠️ Call Not Picked - DNP (${formattedDateStr}) by ${callerName}]: Next action scheduled for ${nextActionDate || 'TBD'} (${nextActionType}). ${remarks ? `Remarks: ${remarks}` : ''}`
      newNotes = dnpNote + (newNotes ? `\n\n${newNotes}` : '')
    } else if (remarks) {
      const remarkNote = `[📝 Followup (${followupType}) - ${formattedDateStr} by ${callerName}]: Stage: ${activeStage}. ${remarks}`
      newNotes = remarkNote + (newNotes ? `\n\n${newNotes}` : '')
    }

    updatePayload.notes = newNotes

    // Apply update to lead in DB
    const { error: updateErr } = await supabaseAdmin
      .from('leads')
      .update(updatePayload)
      .eq('id', leadId)

    if (updateErr) throw updateErr

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
      ? `⚠️ Call Not Picked (DNP) logged by ${callerName}. Next Action: ${nextActionType} on ${formattedNextActionText}. ${remarks ? `Remarks: ${remarks}` : ''}`
      : `📝 Followup (${followupType}) updated by ${callerName}. Stage: ${activeStage}${clientStatus ? `, Rating: ${clientStatus}` : ''}. ${remarks ? `Remarks: ${remarks}` : ''}`

    const isExplicitStageChange = Boolean(leadStatus && leadStatus !== lead.pipeline_stage && leadStatus !== 'Ongoing')

    await supabaseAdmin.from('lead_history').insert({
      lead_id: leadId,
      user_id: user.id,
      action_type: isDnp ? 'REMARK' : (isExplicitStageChange ? 'STATUS_CHANGE' : 'FOLLOWUP'),
      description: historyDesc
    })

    // Manual followup updated successfully (notifications skipped per user request)
    return NextResponse.json({
      success: true,
      message: isDnp ? 'DNP followup logged successfully' : 'Followup updated successfully'
    })
  } catch (err: any) {
    console.error('[CRM FOLLOWUP ROUTE] Exception:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
