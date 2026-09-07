import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendAdminMultiChannelNotification } from '@/utils/notification-helper'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      leadId,
      profileId,
      bookingTime,
      isQualified,
      leadPriority,
      summary = '',
      extractedAnswers = {},
      extractedBudget = null,
      skipProspectWhatsApp = true
    } = body

    if (!leadId) {
      return NextResponse.json({ success: false, error: 'leadId is required' }, { status: 400 })
    }

    // 1. Fetch lead and profile
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, email, pipeline_stage, status, custom_fields, user_id, budget')
      .eq('id', leadId)
      .single()

    if (leadErr || !lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 })
    }

    const ownerUserId = profileId || lead.user_id

    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, whatsapp_personal_number, business_name, business_info')
      .eq('id', ownerUserId)
      .single()

    const leadName = lead.name || 'Valued Prospect'
    const leadPhone = lead.phone || 'N/A'
    const budgetVal = extractedBudget || lead.budget || lead.custom_fields?.budget || 'Not specified'

    let formattedAnswersStr = ''
    if (extractedAnswers && typeof extractedAnswers === 'object' && Object.keys(extractedAnswers).length > 0) {
      formattedAnswersStr = Object.entries(extractedAnswers)
        .map(([k, v]) => `• ${k.replace(/_/g, ' ')}: ${v}`)
        .join('\n')
    }

    // CASE 1: Site visit / appointment booked
    if (bookingTime) {
      let slotDate = new Date(bookingTime)
      if (isNaN(slotDate.getTime())) {
        // Fallback for relative strings like "Saturday"
        const now = new Date()
        slotDate = new Date(now.getTime() + 48 * 3600 * 1000)
      }
      const formattedSlotDate = !isNaN(slotDate.getTime())
        ? slotDate.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'full',
            timeStyle: 'short'
          })
        : bookingTime

      const leadUpdatePayload: Record<string, any> = {
        pipeline_stage: 'Appointment Booked',
        status: 'Appointment Booked'
      }
      if (!isNaN(slotDate.getTime())) {
        leadUpdatePayload.booked_time = slotDate.toISOString()
      }

      // Ensure stage is Appointment Booked
      await supabaseAdmin
        .from('leads')
        .update(leadUpdatePayload)
        .eq('id', leadId)

      // Send Multi-channel notification to Admin (WhatsApp + Email)
      await sendAdminMultiChannelNotification({
        ownerUserId,
        title: `🎙️ Site Visit / Appointment Booked: ${leadName}`,
        body: `AI Voice Agent successfully scheduled an on-site visit/appointment with ${leadName}!\n\n📅 Date & Time: ${formattedSlotDate} (IST)\n📞 Phone: ${leadPhone}\n💰 Budget: ${budgetVal}\n${formattedAnswersStr ? `\n📋 Answers:\n${formattedAnswersStr}\n` : ''}\n📝 Call Summary: ${summary}`,
        url: `/dashboard/crm/${leadId}`,
        type: 'meeting_booked',
        emailSubject: `🎙️ Site Visit / Appointment Booked: ${leadName} (${formattedSlotDate})`
      })

      console.log(`[POST-CALL NOTIFY] Sent Appointment Booked admin alert for lead ${leadId}`)

      return NextResponse.json({
        success: true,
        action: 'appointment_booked_notified',
        bookingTime,
        leadId
      })
    }

    // CASE 2: Prospect showed interest (Qualified / HOT / WARM) without fixed appointment slot
    const hasClearInterest = isQualified || leadPriority === 'HOT' || leadPriority === 'WARM' || Object.keys(extractedAnswers || {}).length > 0

    if (hasClearInterest) {
      // Transition CRM stage to 'Interested' if currently 'New' or 'New Lead'
      if (!lead.pipeline_stage || lead.pipeline_stage === 'New' || lead.pipeline_stage === 'New Lead') {
        await supabaseAdmin
          .from('leads')
          .update({
            pipeline_stage: 'Interested',
            status: 'Interested'
          })
          .eq('id', leadId)
      }

      const priorityLabel = leadPriority || 'HOT'

      // Send Multi-channel notification to Admin (WhatsApp + Email)
      await sendAdminMultiChannelNotification({
        ownerUserId,
        title: `🔥 High-Interest Lead Alert: ${leadName}`,
        body: `Prospect expressed strong interest in commercial properties during AI calling!\n\n👤 Lead: ${leadName}\n📞 Phone: ${leadPhone}\n🔥 Priority: ${priorityLabel}\n💰 Budget: ${budgetVal}\n${formattedAnswersStr ? `\n📋 Qualification Answers:\n${formattedAnswersStr}\n` : ''}\n📝 Call Summary: ${summary}`,
        url: `/dashboard/crm/${leadId}`,
        type: 'lead_interested',
        emailSubject: `🔥 High-Interest Lead Alert: ${leadName} (${priorityLabel}) - Mohali Aerocity`
      })

      console.log(`[POST-CALL NOTIFY] Sent Interested Lead admin alert for lead ${leadId}`)

      return NextResponse.json({
        success: true,
        action: 'interest_notified',
        leadPriority: priorityLabel,
        leadId
      })
    }

    return NextResponse.json({ success: true, action: 'none_needed' })
  } catch (err: any) {
    console.error('[POST-CALL NOTIFY ERROR]', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
