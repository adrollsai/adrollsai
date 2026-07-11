import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendReminderEmail } from '@/utils/email-helper'

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper to format friendly appointment time
function formatFriendlyDate(isoStr: string) {
  return new Date(isoStr).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}

// Helper to send outbound WhatsApp text message
async function sendWhatsAppReminder(
  accessToken: string,
  phoneNumberId: string,
  toPhone: string,
  message: string
) {
  try {
    const cleanPhone = toPhone.replace(/[^0-9]/g, '')
    // Add default country code if missing
    const finalPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone

    const metaUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`
    const messagePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: finalPhone,
      type: 'text',
      text: { body: message }
    }

    const res = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messagePayload)
    })

    const data = await res.json()
    if (!res.ok) {
      console.error('[CRON REMINDERS WORKER] WhatsApp Send Error Response:', data)
      return { success: false, error: data }
    }
    return { success: true, messageId: data.messages?.[0]?.id }
  } catch (e: any) {
    console.error('[CRON REMINDERS WORKER] WhatsApp Fetch Exception:', e.message)
    return { success: false, error: e.message }
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Security check
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('[CRON REMINDERS WORKER] Unauthorized worker execution attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id: leadId, type: reminderType } = body

    if (!leadId || !reminderType) {
      return NextResponse.json({ error: 'Missing parameter: id, type' }, { status: 400 })
    }

    console.log(`[CRON REMINDERS WORKER] Processing ${reminderType} reminder for lead ID: ${leadId}...`)

    // A. Fetch lead details
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .maybeSingle()

    if (leadErr) throw leadErr
    if (!lead || !lead.booked_time) {
      return NextResponse.json({ error: 'Lead or booking details not found' }, { status: 404 })
    }

    // Double check that reminder has not been sent already
    let alreadySent = false
    let updatePayload: any = null
    let timeLeftStr = ''

    if (reminderType === '24h') {
      alreadySent = lead.reminder_24h_sent
      updatePayload = { reminder_24h_sent: true }
      timeLeftStr = '24 hours'
    } else if (reminderType === '4h') {
      alreadySent = lead.reminder_4h_sent
      updatePayload = { reminder_4h_sent: true }
      timeLeftStr = '4 hours'
    } else if (reminderType === '1h') {
      alreadySent = lead.reminder_1h_sent
      updatePayload = { reminder_1h_sent: true }
      timeLeftStr = '1 hour'
    } else if (reminderType === '15m') {
      alreadySent = lead.reminder_15m_sent
      updatePayload = { reminder_15m_sent: true }
      timeLeftStr = '15 minutes'
    }

    if (alreadySent) {
      console.log(`[CRON REMINDERS WORKER] Reminder ${reminderType} already sent for lead ${leadId}. Skipping.`)
      return NextResponse.json({ success: true, message: 'Already sent' })
    }

    // B. Fetch host profile settings
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, email, whatsapp_access_token, whatsapp_phone_number_id, custom_domain')
      .eq('id', lead.user_id)
      .maybeSingle()

    if (!profile) {
      return NextResponse.json({ error: 'Host profile not found' }, { status: 404 })
    }

    // Construct rescheduling and cancellation links
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
    const baseDomain = profile.custom_domain ? `https://${profile.custom_domain}` : appUrl
    const rescheduleLink = `${baseDomain}/booking/${lead.id}?action=reschedule`
    const cancelLink = `${baseDomain}/booking/${lead.id}?action=cancel`

    // Resolve lead email
    let leadEmail = lead.email || ''
    if (!leadEmail && lead.custom_fields) {
      try {
        const custom = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : lead.custom_fields
        const customKeys = Object.keys(custom)
        const emailKey = customKeys.find(k => k.toLowerCase().includes('email'))
        if (emailKey) {
          leadEmail = custom[emailKey]
        }
      } catch (e) {
        console.warn('[CRON REMINDERS WORKER] Error parsing email from custom_fields:', e)
      }
    }

    const friendlyTime = formatFriendlyDate(lead.booked_time)

    // 1. Dispatch Email Reminder
    if (leadEmail) {
      console.log(`[CRON REMINDERS WORKER] Sending email to ${leadEmail}...`)
      await sendReminderEmail(
        leadEmail,
        lead.name,
        lead.booked_time,
        lead.meet_link || '',
        rescheduleLink,
        cancelLink,
        profile.business_name || 'Our Team',
        'Asia/Kolkata',
        timeLeftStr
      ).catch(e => console.error('[CRON REMINDERS WORKER] Email dispatch failed:', e))
    }

    // 2. Dispatch WhatsApp Reminder
    if (profile.whatsapp_access_token && profile.whatsapp_phone_number_id && lead.phone) {
      console.log(`[CRON REMINDERS WORKER] Sending WhatsApp message to ${lead.phone}...`)
      const waBody = `⏰ Meeting Reminder: Your appointment with ${profile.business_name || 'us'} is scheduled in ${timeLeftStr} (${friendlyTime}).\n\n${
        lead.meet_link ? `🎥 Google Meet link: ${lead.meet_link}\n\n` : ''
      }Need to change details?\n🔄 Reschedule: ${rescheduleLink}\n❌ Cancel: ${cancelLink}`
      
      await sendWhatsAppReminder(
        profile.whatsapp_access_token,
        profile.whatsapp_phone_number_id,
        lead.phone,
        waBody
      ).catch(e => console.error('[CRON REMINDERS WORKER] WhatsApp dispatch failed:', e))
    }

    // 3. Mark reminder as sent in DB
    const { error: updErr } = await supabaseAdmin
      .from('leads')
      .update(updatePayload)
      .eq('id', lead.id)

    if (updErr) {
      console.error(`[CRON REMINDERS WORKER] Failed to update lead reminder state for ${lead.id}:`, updErr.message)
      throw updErr
    }

    console.log(`[CRON REMINDERS WORKER] Successfully sent and recorded ${reminderType} reminder for lead ${leadId}`)
    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('[CRON REMINDERS WORKER] Execution failed:', error)
    return NextResponse.json({ error: error.message || 'Worker execution failed' }, { status: 500 })
  }
}
