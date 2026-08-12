import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendFollowupReminderEmail } from '@/utils/email-helper'
import { sendPushNotification } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
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
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

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
    }

    if (leadStatus) {
      updatePayload.status = leadStatus
      const stageMap: Record<string, string> = {
        'New Lead': 'New',
        'Ongoing': 'Ongoing',
        'Requirement Taken': 'Contacted',
        'Visit Planned': 'Appointment booked',
        'Visit Done': 'Appointment done',
        'Revisit Done': 'Appointment done',
        'Negotiation': 'Qualified',
        'Deal/Token': 'Closed',
        'Lost/NI': 'Unqualified'
      }
      updatePayload.pipeline_stage = body.pipelineStage || stageMap[leadStatus] || leadStatus
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
    if (nextActionDate) customFields.next_action_date = nextActionDate
    if (nextActionType) customFields.next_action_type = nextActionType

    if (clientStatus) {
      customFields.client_status = clientStatus
    }

    if (isDnp) {
      customFields.last_call_dnp = true
      customFields.dnp_count = (customFields.dnp_count || 0) + 1
      // Automatically advance attempted lead from New Lead to Ongoing stage
      const currentStage = lead.status || lead.pipeline_stage || 'New Lead'
      if (currentStage === 'New Lead' || currentStage === 'New') {
        updatePayload.status = 'Ongoing'
        updatePayload.pipeline_stage = 'Ongoing'
      }
    } else {
      customFields.last_call_dnp = false
    }

    if (referenceName) customFields.reference_name = referenceName
    if (referenceNo) customFields.reference_no = referenceNo
    if (interestedProperties && Array.isArray(interestedProperties)) {
      customFields.interested_properties = interestedProperties
    }

    updatePayload.custom_fields = customFields

    // Prepend remarks to notes if provided
    let newNotes = lead.notes || ''
    const formattedDateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    
    if (isDnp) {
      const dnpNote = `[⚠️ Call Not Picked - DNP (${formattedDateStr}) by ${callerName}]: Next action scheduled for ${nextActionDate || 'TBD'} (${nextActionType}). ${remarks ? `Remarks: ${remarks}` : ''}`
      newNotes = dnpNote + (newNotes ? `\n\n${newNotes}` : '')
    } else if (remarks) {
      const remarkNote = `[📝 Followup (${followupType}) - ${formattedDateStr} by ${callerName}]: Status: ${leadStatus || lead.pipeline_stage}. ${remarks}`
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
      : `📝 Followup (${followupType}) updated by ${callerName}. Stage: ${leadStatus || lead.pipeline_stage}${clientStatus ? `, Rating: ${clientStatus}` : ''}. ${remarks ? `Remarks: ${remarks}` : ''}`

    await supabaseAdmin.from('lead_history').insert({
      lead_id: leadId,
      user_id: user.id,
      action_type: isDnp ? 'REMARK' : 'STATUS_CHANGE',
      description: historyDesc
    })

    // Send Push & Email Notifications for next action / followup
    try {
      const assignedTargetId = assignedTo || lead.assigned_to || user.id
      const { data: assignedProfile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name, business_name')
        .eq('id', assignedTargetId)
        .maybeSingle()

      const formattedActionDate = nextActionDate 
        ? new Date(nextActionDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'TBD';

      // Push notification skipped on manual follow-up update per request

      if (assignedProfile?.email) {
        const agentName = assignedProfile.full_name || assignedProfile.business_name || 'Sales Rep'
        await sendFollowupReminderEmail(
          assignedProfile.email,
          agentName,
          lead.name || 'Prospect Lead',
          lead.phone || 'N/A',
          nextActionType || followupType,
          nextActionDate || followupDate || new Date().toISOString(),
          remarks || ''
        )
        console.log(`[Followup API] Sent reminder email to ${assignedProfile.email} for lead ${lead.name}`);
      }
    } catch (notifErr) {
      console.error("[Followup API] Failed to send notification alerts to assigned rep:", notifErr)
    }

    return NextResponse.json({
      success: true,
      message: isDnp ? 'DNP followup logged successfully' : 'Followup updated successfully'
    })
  } catch (err: any) {
    console.error('[CRM FOLLOWUP ROUTE] Exception:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
