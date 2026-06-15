import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { refreshGoogleAccessToken, getCalendarTimezone } from '@/utils/google-calendar'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { lead_id, slot, user_id } = body

    if (!lead_id || !slot || !user_id) {
      return NextResponse.json({ error: "Missing required parameters: lead_id, slot, user_id" }, { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1. Fetch Lead Details
    const { data: lead, error: leadError } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle()

    if (leadError) throw leadError
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    }

    // 2. Fetch Host Settings
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('google_refresh_token, google_booking_enabled, google_booking_duration, business_name, google_calendar_id')
      .eq('id', user_id)
      .maybeSingle()

    if (profileError) throw profileError

    if (!profile || !profile.google_refresh_token || !profile.google_booking_enabled) {
      return NextResponse.json({ error: "Host booking is not configured" }, { status: 400 })
    }

    const refreshToken = profile.google_refresh_token
    const duration = profile.google_booking_duration || 30

    // 3. Refresh Access Token & Get Timezone
    const accessToken = await refreshGoogleAccessToken(refreshToken)
    const timeZone = await getCalendarTimezone(accessToken)

    // Calculate Event End Time
    const start = new Date(slot)
    const end = new Date(start.getTime() + (duration * 60000))

    // Parse lead details
    // If the lead email is captured in custom_fields or standard fields, let's extract it!
    let leadEmail = lead.email || ""
    if (!leadEmail && lead.custom_fields) {
      const customKeys = Object.keys(lead.custom_fields)
      const emailKey = customKeys.find(k => k.toLowerCase().includes('email'))
      if (emailKey) {
        leadEmail = lead.custom_fields[emailKey]
      }
    }

    // 4. Create Calendar Event on Google Calendar
    const eventBody: any = {
      summary: `Meeting with ${lead.name}`,
      description: `Google Calendar Booking from Landing Page.\nName: ${lead.name}\nPhone: ${lead.phone || 'N/A'}\nCity: ${lead.custom_fields?.city || 'N/A'}\n\nGenerated via AdRolls CRM.`,
      start: {
        dateTime: start.toISOString(),
        timeZone
      },
      end: {
        dateTime: end.toISOString(),
        timeZone
      },
      reminders: {
        useDefault: true
      }
    }

    if (leadEmail) {
      eventBody.attendees = [{ email: leadEmail }]
    }

    const calendarId = encodeURIComponent(profile.google_calendar_id || 'primary')
    const calendarEventRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?sendUpdates=all`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventBody)
    })

    const eventResult = await calendarEventRes.json()

    if (eventResult.error) {
      console.error("[Google Calendar Create Event] API Error:", eventResult)
      throw new Error(eventResult.error.message || "Failed to create Google Calendar event")
    }

    // 5. Update Lead in Supabase
    const { error: updateError } = await supabaseAdmin
      .from('leads')
      .update({ booked_time: slot })
      .eq('id', lead_id)

    if (updateError) throw updateError

    console.log(`[Booking Create API] Successfully booked slot ${slot} for Lead ID: ${lead_id}`)

    return NextResponse.json({ success: true, eventId: eventResult.id })

  } catch (error: any) {
    console.error("[Google Calendar Booking Create API] Error:", error)
    return NextResponse.json({ error: error.message || "Failed to book appointment" }, { status: 500 })
  }
}
