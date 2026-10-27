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
      callbackTime,
      isQualified,
      isInterested,
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
      .select('id, name, phone, email, pipeline_stage, status, custom_fields, user_id, budget, source, ad_name, campaign_id, voice_campaign_id, notes, summary, voice_call_summary, assigned_to')
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

    let cf = lead.custom_fields || {}
    if (typeof cf === 'string') {
      try { cf = JSON.parse(cf) } catch (e) {}
    }

    // CRITICAL: NEVER push demo calls or test calls initiated from rchopra489 or any admin test to client admins!
    const isDemoOrTestCall = 
      cf.is_demo_call === true ||
      cf.is_test_call === true ||
      cf.skip_credit_deduction === true ||
      !!cf.triggered_by_admin ||
      lead.source === 'AI Call Demo' ||
      lead.source === 'Test Call' ||
      lead.source === 'Internal Demo';

    if (isDemoOrTestCall) {
      console.log(`[POST-CALL NOTIFY] Suppressed client admin notification for demo/test call (lead: ${leadId}, triggered_by: ${cf.triggered_by_admin || 'admin'})`);
      return NextResponse.json({
        success: true,
        action: 'demo_call_suppressed',
        message: 'Client admin notification suppressed for demo/test call',
        leadId
      });
    }

    const budgetVal = extractedBudget || lead.budget || cf.budget || 'Not specified'

    // Dynamically resolve voice campaign name if available
    let voiceCampaignName = ''
    if (lead.voice_campaign_id) {
      try {
        const { data: vCamp } = await supabaseAdmin
          .from('voice_campaigns')
          .select('name')
          .eq('id', lead.voice_campaign_id)
          .maybeSingle()
        if (vCamp?.name) {
          voiceCampaignName = vCamp.name
        }
      } catch (e) {}
    }

    // Resolve property and source/campaign context
    const projectName = cf.interested_property || cf.property_type || cf.project_name || voiceCampaignName || ''
    const propertyLabel = projectName || (ownerProfile?.business_name ? `${ownerProfile.business_name} Property` : 'Real Estate Inquiry')
    const leadSource = lead.source || cf.source || 'Meta Ads'
    const campaignName = cf.meta_ad_origin?.campaign_name || cf.campaign_name || voiceCampaignName || lead.ad_name || 'Campaign'

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
        body: `AI Voice Agent successfully scheduled an on-site visit/appointment with ${leadName}!\n\n📅 Date & Time: ${formattedSlotDate} (IST)\n👤 Lead: ${leadName}\n📞 Phone: ${leadPhone}\n🏢 Project / Property: ${propertyLabel}\n📢 Source: ${leadSource} (${campaignName})\n💰 Budget: ${budgetVal}\n${formattedAnswersStr ? `\n📋 Answers:\n${formattedAnswersStr}\n` : ''}\n📝 Call Summary: ${summary}`,
        url: `/dashboard/crm/${leadId}`,
        type: 'meeting_booked',
        leadPhone,
        leadName,
        leadId,
        emailSubject: `🎙️ Site Visit / Appointment Booked: ${leadName} (${propertyLabel})`
      })

      // Also notify assigned agent if lead is assigned to someone other than owner
      if (lead.assigned_to && lead.assigned_to !== ownerUserId) {
        try {
          await sendAdminMultiChannelNotification({
            ownerUserId: lead.assigned_to,
            title: `🎙️ Site Visit / Appointment Booked: ${leadName}`,
            body: `AI Voice Agent successfully scheduled an on-site visit/appointment for your assigned lead ${leadName}!\n\n📅 Date & Time: ${formattedSlotDate} (IST)\n👤 Lead: ${leadName}\n📞 Phone: ${leadPhone}\n🏢 Project / Property: ${propertyLabel}\n📢 Source: ${leadSource} (${campaignName})\n💰 Budget: ${budgetVal}${formattedAnswersStr ? `\n\n📋 Answers:\n${formattedAnswersStr}\n` : ''}\n📝 Call Summary: ${summary}`,
            url: `/dashboard/crm/${leadId}`,
            type: 'meeting_booked',
            leadPhone,
            leadName,
            leadId,
            emailSubject: `🎙️ Site Visit / Appointment Booked for Assigned Lead: ${leadName} (${propertyLabel})`
          })
          console.log(`[POST-CALL NOTIFY] Sent Appointment Booked alert to assigned agent ${lead.assigned_to}`)
        } catch (agentErr: any) {
          console.warn(`[POST-CALL NOTIFY] Error notifying assigned agent ${lead.assigned_to}:`, agentErr.message)
        }
      }

      console.log(`[POST-CALL NOTIFY] Sent Appointment Booked admin alert for lead ${leadId}`)

      return NextResponse.json({
        success: true,
        action: 'appointment_booked_notified',
        bookingTime,
        leadId
      })
    }

    // CASE 2: Prospect confirmed interest / qualified (even if appointment is pending)
    if (isInterested || isQualified || leadPriority === 'HOT') {
      await sendAdminMultiChannelNotification({
        ownerUserId,
        title: `🔥 High Interest Lead: ${leadName}`,
        body: `Prospect ${leadName} confirmed interest during AI call for ${propertyLabel}!\n\n👤 Lead: ${leadName}\n📞 Phone: ${leadPhone}\n🏢 Project / Property: ${propertyLabel}\n📢 Source: ${leadSource} (${campaignName})\n💰 Budget: ${budgetVal}${formattedAnswersStr ? `\n\n📋 Answers:\n${formattedAnswersStr}` : ''}\n\n📝 Call Summary: ${summary}`,
        url: `/dashboard/crm/${leadId}`,
        type: 'expert_escalation',
        leadPhone,
        leadName,
        leadId,
        emailSubject: `🔥 High Interest Lead: ${leadName} (${propertyLabel})`
      });

      if (lead.assigned_to && lead.assigned_to !== ownerUserId) {
        try {
          await sendAdminMultiChannelNotification({
            ownerUserId: lead.assigned_to,
            title: `🔥 High Interest Lead: ${leadName}`,
            body: `Assigned prospect ${leadName} confirmed interest during AI call for ${propertyLabel}!\n\n👤 Lead: ${leadName}\n📞 Phone: ${leadPhone}\n🏢 Project / Property: ${propertyLabel}\n📢 Source: ${leadSource} (${campaignName})\n💰 Budget: ${budgetVal}${formattedAnswersStr ? `\n\n📋 Answers:\n${formattedAnswersStr}` : ''}\n\n📝 Call Summary: ${summary}`,
            url: `/dashboard/crm/${leadId}`,
            type: 'expert_escalation',
            leadPhone,
            leadName,
            leadId,
            emailSubject: `🔥 High Interest Lead: ${leadName} (${propertyLabel})`
          });
        } catch (e) {}
      }

      console.log(`[POST-CALL NOTIFY] Sent High Interest admin alert for lead ${leadId}`);
      return NextResponse.json({
        success: true,
        action: 'high_interest_notified',
        leadId
      });
    }

    // CASE 3: Prospect requested a callback at a specific time
    if (callbackTime) {
      let cbDate = new Date(callbackTime);
      const formattedCbDate = !isNaN(cbDate.getTime())
        ? cbDate.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short'
          })
        : callbackTime;

      await sendAdminMultiChannelNotification({
        ownerUserId,
        title: `📞 Callback Requested: ${leadName}`,
        body: `Prospect ${leadName} requested a callback at ${formattedCbDate} regarding ${propertyLabel}.\n\n👤 Lead: ${leadName}\n📞 Phone: ${leadPhone}\n⏰ Callback Time: ${formattedCbDate}\n📝 Call Summary: ${summary}`,
        url: `/dashboard/crm/${leadId}`,
        type: 'crm_reminder',
        leadPhone,
        leadName,
        leadId,
        emailSubject: `📞 Callback Requested: ${leadName} at ${formattedCbDate}`
      });

      if (lead.assigned_to && lead.assigned_to !== ownerUserId) {
        try {
          await sendAdminMultiChannelNotification({
            ownerUserId: lead.assigned_to,
            title: `📞 Callback Requested: ${leadName}`,
            body: `Assigned prospect ${leadName} requested a callback at ${formattedCbDate} regarding ${propertyLabel}.\n\n👤 Lead: ${leadName}\n📞 Phone: ${leadPhone}\n⏰ Callback Time: ${formattedCbDate}\n📝 Call Summary: ${summary}`,
            url: `/dashboard/crm/${leadId}`,
            type: 'crm_reminder',
            leadPhone,
            leadName,
            leadId,
            emailSubject: `📞 Callback Requested for Assigned Lead: ${leadName} at ${formattedCbDate}`
          });
          console.log(`[POST-CALL NOTIFY] Sent Callback alert to assigned agent ${lead.assigned_to}`);
        } catch (agentErr: any) {
          console.warn(`[POST-CALL NOTIFY] Error notifying assigned agent for callback:`, agentErr.message);
        }
      }

      console.log(`[POST-CALL NOTIFY] Callback requested for lead ${leadId} at ${formattedCbDate}. Alert dispatched to admin and assigned agent.`);
      return NextResponse.json({
        success: true,
        action: 'callback_noted',
        callbackTime,
        leadId
      });
    }

    // CASE 4: Call completed without high interest or booking
    console.log(`[POST-CALL NOTIFY] Call completed for lead ${leadId} without high interest/booking. Kept in Fresh section for tele-callers.`);
    return NextResponse.json({
      success: true,
      action: 'fresh_retained_no_alert',
      leadId
    });
  } catch (err: any) {
    console.error('[POST-CALL NOTIFY ERROR]', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
