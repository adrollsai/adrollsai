import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

// 1. ABSOLUTE CACHE BUSTING (This fixes the missing notifications)
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        global: { fetch: fetch } 
      }
    )

    // NO MORE TIMEZONE HACK. Use strict current UTC time.
    const nowUtcString = new Date().toISOString()

    // --- 1. FOLLOW-UP PUSH NOTIFICATIONS ---
    const { data: leadsToRemind, error } = await supabaseAdmin
      .from('leads')
      .select('id, user_id, name, phone, next_followup')
      .not('next_followup', 'is', null)
      .lte('next_followup', nowUtcString)

    if (error) throw error;

    let successfulPushes = 0;
    if (leadsToRemind && leadsToRemind.length > 0) {
      for (const lead of leadsToRemind) {
        try {
            await sendPushNotification(
                lead.user_id,
                "Follow-Up Reminder ⏰",
                `Time to follow up with ${lead.name} ${lead.phone ? `(${lead.phone})` : ''}`,
                `/dashboard/crm/${lead.id}`, 
                "reminder"
            )

            // Clear the reminder so it doesn't trigger again
            const { error: updateError } = await supabaseAdmin
                .from('leads')
                .update({ next_followup: null })
                .eq('id', lead.id)

            if (!updateError) successfulPushes++;
        } catch (pushError) {
            console.error(`Failed to process lead ${lead.id}:`, pushError);
        }
      }
    }

    // --- 2. BOOKING EMAIL REMINDERS (30 mins before meeting) ---
    let successfulEmailReminders = 0;
    let totalBookingsFound = 0;
    try {
      const now = new Date()
      const targetTime = new Date(now.getTime() + 35 * 60 * 1000) // 35 minutes from now

      // Query leads who have a booking in the next 30-35 mins, and reminder hasn't been sent
      const { data: bookingsToRemind, error: bookingErr } = await supabaseAdmin
        .from('leads')
        .select('id, user_id, name, email, phone, booked_time, meet_link, booking_reminder_sent, custom_fields')
        .not('booked_time', 'is', null)
        .eq('booking_reminder_sent', false)
        .gte('booked_time', now.toISOString())
        .lte('booked_time', targetTime.toISOString())

      if (bookingErr) throw bookingErr;

      if (bookingsToRemind && bookingsToRemind.length > 0) {
        totalBookingsFound = bookingsToRemind.length;
        const { sendBookingReminderEmail } = await import('@/utils/email-helper')
        
        for (const booking of bookingsToRemind) {
          try {
            // Fetch host (user) profile details (email and business name)
            const { data: profile } = await supabaseAdmin
              .from('profiles')
              .select('email, business_name')
              .eq('id', booking.user_id)
              .maybeSingle()

            // 1. Send email to host
            if (profile?.email) {
              await sendBookingReminderEmail(
                profile.email,
                true, // isHost = true
                booking.name,
                booking.booked_time,
                booking.meet_link || '',
                profile.business_name || 'Consultation'
              )
            }

            // 2. Send email to lead (if email is provided)
            let leadEmail = booking.email || ""
            if (!leadEmail && booking.custom_fields) {
              const customFieldsObj = booking.custom_fields as any
              const customKeys = Object.keys(customFieldsObj)
              const emailKey = customKeys.find(k => k.toLowerCase().includes('email'))
              if (emailKey) {
                leadEmail = customFieldsObj[emailKey]
              }
            }

            if (leadEmail) {
              await sendBookingReminderEmail(
                leadEmail,
                false, // isHost = false
                booking.name,
                booking.booked_time,
                booking.meet_link || '',
                profile?.business_name || 'Consultation'
              )
            }

            // Update reminder sent status on lead
            await supabaseAdmin
              .from('leads')
              .update({ booking_reminder_sent: true })
              .eq('id', booking.id)

            successfulEmailReminders++;
          } catch (remErr) {
            console.error(`[Cron] Failed to process booking reminder for lead ${booking.id}:`, remErr)
          }
        }
      }
    } catch (bookingCronErr) {
      console.error("[Cron] Error processing booking reminders:", bookingCronErr)
    }

    return NextResponse.json({ 
        success: true, 
        processedPushes: successfulPushes,
        totalPushesFound: leadsToRemind ? leadsToRemind.length : 0,
        processedEmails: successfulEmailReminders,
        totalEmailsFound: totalBookingsFound
    })

  } catch (error: any) {
    console.error("Cron Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}