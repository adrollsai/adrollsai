import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
    global: { fetch: fetch } 
  }
)

export async function POST(request: Request) {
  try {
    // 1. Security check
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('[Reminders Worker] Unauthorized worker execution attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id: leadId, type: reminderType } = body

    if (!leadId || !reminderType) {
      return NextResponse.json({ error: 'Missing parameter: id, type' }, { status: 400 })
    }

    console.log(`[Reminders Worker] Processing ${reminderType} task for lead ID: ${leadId}...`)

    // A. Handle CRM Follow-Up Push Notification
    if (reminderType === 'followup') {
      const { data: lead, error: leadErr } = await supabaseAdmin
        .from('leads')
        .select('id, user_id, name, phone, next_followup')
        .eq('id', leadId)
        .maybeSingle()

      if (leadErr) throw leadErr
      if (!lead) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      }

      if (!lead.next_followup) {
        return NextResponse.json({ message: 'Next follow-up date already cleared' })
      }

      // Send the Push Notification
      await sendPushNotification(
        lead.user_id,
        "Follow-Up Reminder ⏰",
        `Time to follow up with ${lead.name} ${lead.phone ? `(${lead.phone})` : ''}`,
        `/dashboard/crm/${lead.id}`, 
        "reminder"
      )

      // Clear the next_followup date so it doesn't trigger again
      const { error: updateError } = await supabaseAdmin
        .from('leads')
        .update({ next_followup: null })
        .eq('id', leadId)

      if (updateError) throw updateError

      console.log(`[Reminders Worker] Successfully sent follow-up push alert for lead ${leadId}`)
      return NextResponse.json({ success: true })
    }

    // B. Handle 30-Minute Booking Email Reminder
    if (reminderType === 'booking_30m') {
      const { data: booking, error: bookingErr } = await supabaseAdmin
        .from('leads')
        .select('id, user_id, name, email, phone, booked_time, meet_link, booking_reminder_sent, custom_fields')
        .eq('id', leadId)
        .maybeSingle()

      if (bookingErr) throw bookingErr
      if (!booking || !booking.booked_time) {
        return NextResponse.json({ error: 'Booking details not found' }, { status: 404 })
      }

      if (booking.booking_reminder_sent) {
        console.log(`[Reminders Worker] 30m booking reminder already sent for lead ${leadId}. Skipping.`)
        return NextResponse.json({ success: true, message: 'Already sent' })
      }

      // Fetch host profile
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, business_name')
        .eq('id', booking.user_id)
        .maybeSingle()

      // Resolve lead email
      let leadEmail = booking.email || ""
      if (!leadEmail && booking.custom_fields) {
        try {
          const customFieldsObj = booking.custom_fields as any
          const customKeys = Object.keys(customFieldsObj)
          const emailKey = customKeys.find(k => k.toLowerCase().includes('email'))
          if (emailKey) {
            leadEmail = customFieldsObj[emailKey]
          }
        } catch (e) {
          console.warn('[Reminders Worker] Failed parsing lead email from custom_fields:', e)
        }
      }

      const { sendBookingReminderEmail } = await import('@/utils/email-helper')

      // 1. Send email to host
      if (profile?.email) {
        await sendBookingReminderEmail(
          profile.email,
          true, // isHost = true
          booking.name,
          booking.booked_time,
          booking.meet_link || '',
          profile.business_name || 'Consultation'
        ).catch(e => console.error('[Reminders Worker] Failed to send 30m email to host:', e))
      }

      // 2. Send email to lead
      if (leadEmail) {
        await sendBookingReminderEmail(
          leadEmail,
          false, // isHost = false
          booking.name,
          booking.booked_time,
          booking.meet_link || '',
          profile?.business_name || 'Consultation'
        ).catch(e => console.error('[Reminders Worker] Failed to send 30m email to lead:', e))
      }

      // Update reminder sent status on lead
      const { error: updateError } = await supabaseAdmin
        .from('leads')
        .update({ booking_reminder_sent: true })
        .eq('id', booking.id)

      if (updateError) throw updateError

      console.log(`[Reminders Worker] Successfully sent 30m booking reminders for lead ${leadId}`)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid reminder type' }, { status: 400 })

  } catch (error: any) {
    console.error('[Reminders Worker] Execution failed:', error)
    return NextResponse.json({ error: error.message || 'Worker execution failed' }, { status: 500 })
  }
}
