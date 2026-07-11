import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendReminderEmail } from '@/utils/email-helper'

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
      console.error('[CRON REMINDERS] WhatsApp Send Error Response:', data)
      return { success: false, error: data }
    }
    return { success: true, messageId: data.messages?.[0]?.id }
  } catch (e: any) {
    console.error('[CRON REMINDERS] WhatsApp Fetch Exception:', e.message)
    return { success: false, error: e.message }
  }
}

export async function GET(request: NextRequest) {
  try {
    console.log('[CRON REMINDERS] Running booking reminders check...')

    const now = new Date()

    // 1. Fetch all leads with active future bookings
    const { data: leads, error: leadsErr } = await supabaseAdmin
      .from('leads')
      .select('*')
      .not('booked_time', 'is', null)
      .gt('booked_time', now.toISOString())

    if (leadsErr) throw leadsErr

    if (!leads || leads.length === 0) {
      console.log('[CRON REMINDERS] No future appointments found.')
      return NextResponse.json({ success: true, message: 'No future appointments found.' })
    }

    console.log(`[CRON REMINDERS] Found ${leads.length} upcoming appointments to analyze.`)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'

    for (const lead of leads) {
      const bookedTime = new Date(lead.booked_time)
      const diffMs = bookedTime.getTime() - now.getTime()
      const diffMins = Math.floor(diffMs / 60000)

      // Identify if we need to send a reminder
      let reminderType: '24h' | '4h' | '1h' | '15m' | null = null
      let updatePayload: any = null
      let timeLeftStr = ''

      if (diffMins <= 1440 && diffMins > 240 && !lead.reminder_24h_sent) {
        reminderType = '24h'
        updatePayload = { reminder_24h_sent: true }
        timeLeftStr = '24 hours'
      } else if (diffMins <= 240 && diffMins > 60 && !lead.reminder_4h_sent) {
        reminderType = '4h'
        updatePayload = { reminder_4h_sent: true }
        timeLeftStr = '4 hours'
      } else if (diffMins <= 60 && diffMins > 15 && !lead.reminder_1h_sent) {
        reminderType = '1h'
        updatePayload = { reminder_1h_sent: true }
        timeLeftStr = '1 hour'
      } else if (diffMins <= 15 && diffMins > 0 && !lead.reminder_15m_sent) {
        reminderType = '15m'
        updatePayload = { reminder_15m_sent: true }
        timeLeftStr = '15 minutes'
      }

      if (reminderType && updatePayload) {
        console.log(`[CRON REMINDERS] Triggering ${reminderType} reminder for lead: ${lead.name} (${lead.id}), diff: ${diffMins} mins.`)

        // Fetch host profile settings
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id, business_name, email, whatsapp_access_token, whatsapp_phone_number_id, custom_domain')
          .eq('id', lead.user_id)
          .maybeSingle()

        if (!profile) {
          console.warn(`[CRON REMINDERS] Host profile not found for user_id: ${lead.user_id}`)
          continue
        }

        // Construct rescheduling and cancellation links
        // If profile.custom_domain is connected, use that domain, otherwise default to appUrl
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
            console.warn('[CRON REMINDERS] Error parsing email from custom_fields:', e)
          }
        }

        const friendlyTime = formatFriendlyDate(lead.booked_time)

        // 1. Dispatch Email Reminder
        if (leadEmail) {
          console.log(`[CRON REMINDERS] Sending reminder email to ${leadEmail}...`)
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
          ).catch(e => console.error('[CRON REMINDERS] Email dispatch failed:', e))
        }

        // 2. Dispatch WhatsApp Reminder
        if (profile.whatsapp_access_token && profile.whatsapp_phone_number_id && lead.phone) {
          console.log(`[CRON REMINDERS] Sending reminder WhatsApp message to ${lead.phone}...`)
          const waBody = `⏰ Meeting Reminder: Your appointment with ${profile.business_name || 'us'} is scheduled in ${timeLeftStr} (${friendlyTime}).\n\n${
            lead.meet_link ? `🎥 Google Meet link: ${lead.meet_link}\n\n` : ''
          }Need to change details?\n🔄 Reschedule: ${rescheduleLink}\n❌ Cancel: ${cancelLink}`
          
          await sendWhatsAppReminder(
            profile.whatsapp_access_token,
            profile.whatsapp_phone_number_id,
            lead.phone,
            waBody
          ).catch(e => console.error('[CRON REMINDERS] WhatsApp dispatch failed:', e))
        }

        // 3. Mark reminder as sent in DB
        const { error: updErr } = await supabaseAdmin
          .from('leads')
          .update(updatePayload)
          .eq('id', lead.id)

        if (updErr) {
          console.error(`[CRON REMINDERS] Failed to update lead reminder state for ${lead.id}:`, updErr.message)
        }
      }
    }

    return NextResponse.json({ success: true, message: 'Upcoming booking reminders analyzed and sent.' })
  } catch (error: any) {
    console.error('[CRON REMINDERS] Route error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
