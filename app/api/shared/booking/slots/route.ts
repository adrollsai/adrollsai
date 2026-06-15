import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { refreshGoogleAccessToken, getCalendarTimezone } from '@/utils/google-calendar'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')
  const dateStr = searchParams.get('date') // YYYY-MM-DD format

  if (!userId || !dateStr) {
    return NextResponse.json({ error: "Missing userId or date parameters" }, { status: 400 })
  }

  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Load Host Profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('google_refresh_token, google_booking_enabled, google_booking_duration, google_booking_hours, google_calendar_id')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) throw profileError

    if (!profile || !profile.google_refresh_token || !profile.google_booking_enabled) {
      // Return empty slots if booking is not configured
      return NextResponse.json({ slots: [], timeZone: 'Asia/Kolkata' })
    }

    const refreshToken = profile.google_refresh_token
    const duration = profile.google_booking_duration || 30
    const hours = (profile.google_booking_hours as { start?: string; end?: string }) || {}
    const workStartStr = hours.start || '09:00'
    const workEndStr = hours.end || '17:00'

    // Refresh Google Token
    const accessToken = await refreshGoogleAccessToken(refreshToken)
    const timeZone = await getCalendarTimezone(accessToken)

    // Parse requested date start/end in calendar timezone
    const timeMin = `${dateStr}T00:00:00`
    const timeMax = `${dateStr}T23:59:59`

    const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        timeMin: new Date(`${timeMin}Z`).toISOString(), // UTC bounds search range
        timeMax: new Date(`${timeMax}Z`).toISOString(),
        timeZone,
        items: [{ id: profile.google_calendar_id || 'primary' }]
      })
    })

    const freeBusyData = await freeBusyRes.json()
    const targetCalId = profile.google_calendar_id || 'primary'
    const busyIntervals = freeBusyData.calendars?.[targetCalId]?.busy || []

    // Generate slots in timezone local context
    const [startH, startM] = workStartStr.split(':').map(Number)
    const [endH, endM] = workEndStr.split(':').map(Number)

    // Natively compute local timezone offsets on the date to shift start/end working hours correctly
    function getTimezoneOffset(tz: string, refDate: Date) {
      const tzString = refDate.toLocaleString('en-US', { timeZone: tz })
      const localDate = new Date(tzString)
      const utcDate = new Date(refDate.toLocaleString('en-US', { timeZone: 'UTC' }))
      return (localDate.getTime() - utcDate.getTime()) / 60000
    }

    const refDate = new Date(`${dateStr}T12:00:00Z`)
    const offsetMin = getTimezoneOffset(timeZone, refDate)

    const startUtc = new Date(Date.UTC(
      Number(dateStr.substring(0,4)),
      Number(dateStr.substring(5,7)) - 1,
      Number(dateStr.substring(8,10)),
      startH,
      startM
    ) - (offsetMin * 60000))

    const endUtc = new Date(Date.UTC(
      Number(dateStr.substring(0,4)),
      Number(dateStr.substring(5,7)) - 1,
      Number(dateStr.substring(8,10)),
      endH,
      endM
    ) - (offsetMin * 60000))

    const slots: string[] = []
    let current = new Date(startUtc)
    const now = new Date()

    while (current.getTime() + (duration * 60000) <= endUtc.getTime()) {
      const slotStart = new Date(current)
      const slotEnd = new Date(current.getTime() + (duration * 60000))

      // Check if slot start is in the future
      if (slotStart.getTime() > now.getTime()) {
        let isBusy = false
        for (const busy of busyIntervals) {
          const busyStart = new Date(busy.start)
          const busyEnd = new Date(busy.end)
          
          if (slotStart.getTime() < busyEnd.getTime() && slotEnd.getTime() > busyStart.getTime()) {
            isBusy = true
            break
          }
        }

        if (!isBusy) {
          slots.push(slotStart.toISOString())
        }
      }

      current = new Date(current.getTime() + (duration * 60000))
    }

    return NextResponse.json({ slots, timeZone })

  } catch (error: any) {
    console.error("[Google Calendar Slots API] Error:", error)
    return NextResponse.json({ error: error.message || "Failed to load slots" }, { status: 500 })
  }
}
