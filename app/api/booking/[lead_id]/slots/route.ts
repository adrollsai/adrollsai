import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper to refresh Google Calendar Access Token
async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || 'Failed to refresh Google token')
  return data.access_token
}

// Helper to convert local date/time string to a UTC Date object in a target timezone
function getUtcFromLocalTime(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = timeStr.split(':').map(Number)
  
  // Construct a base UTC date matching the year/month/day/hour/minute
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute))
  
  // Calculate the timezone offset in minutes at this UTC timestamp
  const getOffset = (tz: string, d: Date) => {
    const tzStr = d.toLocaleString('en-US', { timeZone: tz })
    const locD = new Date(tzStr)
    const utcD = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
    return (locD.getTime() - utcD.getTime()) / 60000
  }
  const offsetMin = getOffset(timeZone, utcDate)
  return new Date(utcDate.getTime() - offsetMin * 60000)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ lead_id: string }> }
) {
  try {
    const { lead_id } = await params
    const leadId = lead_id
    const { searchParams } = new URL(request.url)
    const dateQuery = searchParams.get('date') // YYYY-MM-DD

    if (!dateQuery) {
      return NextResponse.json({ error: 'date query parameter is required' }, { status: 400 })
    }

    let profileId = ''
    let profile = null

    if (leadId === 'preview') {
      const hostId = searchParams.get('host_id')
      if (!hostId) {
        return NextResponse.json({ error: 'host_id is required for preview mode' }, { status: 400 })
      }
      
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostId)
      let query = supabaseAdmin
        .from('profiles')
        .select('id, google_refresh_token, google_booking_enabled, google_booking_duration, google_booking_hours, google_calendar_id')
      
      if (isUuid) {
        query = query.eq('id', hostId)
      } else {
        query = query.eq('custom_domain', hostId)
      }

      const { data: prof, error: profErr } = await query.maybeSingle()
      if (profErr) throw profErr
      if (!prof) {
        return NextResponse.json({ error: 'Host profile not found' }, { status: 404 })
      }
      profile = prof
      profileId = prof.id
    } else {
      // 1. Fetch Lead Details
      const { data: lead, error: leadError } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .maybeSingle()

      if (leadError) throw leadError
      if (!lead) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      }

      // 2. Fetch Host Settings
      const { data: prof, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, google_refresh_token, google_booking_enabled, google_booking_duration, google_booking_hours, google_calendar_id')
        .eq('id', lead.user_id)
        .maybeSingle()

      if (profileError) throw profileError
      if (!prof) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }
      profile = prof
      profileId = prof.id
    }
    
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const duration = (profile as any).google_booking_duration || 30
    let bookingHours = { start: '09:00', end: '17:00' }
    if ((profile as any).google_booking_hours && typeof (profile as any).google_booking_hours === 'object') {
      const h = (profile as any).google_booking_hours as any
      if (h.start) bookingHours.start = h.start
      if (h.end) bookingHours.end = h.end
    }

    const timeZone = 'Asia/Kolkata' // Default target timezone

    // 3. Generate candidate slots
    // Split start/end times
    const [startH, startM] = bookingHours.start.split(':').map(Number)
    const [endH, endM] = bookingHours.end.split(':').map(Number)

    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM

    const slots: { time: string; label: string; available: boolean }[] = []

    // Fetch busy windows from Google Calendar if integrated
    let googleEvents: any[] = []
    let isGoogleCalendarLinked = false

    if (profile.google_refresh_token && profile.google_booking_enabled) {
      try {
        const accessToken = await refreshGoogleAccessToken(profile.google_refresh_token)
        const calendarId = encodeURIComponent(profile.google_calendar_id || 'primary')
        
        // Query the entire day range
        const dayStart = getUtcFromLocalTime(dateQuery, bookingHours.start, timeZone).toISOString()
        const dayEnd = getUtcFromLocalTime(dateQuery, bookingHours.end, timeZone).toISOString()

        const checkUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${dayStart}&timeMax=${dayEnd}&singleEvents=true`
        const checkRes = await fetch(checkUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
        const checkData = await checkRes.json()
        if (checkRes.ok && checkData.items) {
          googleEvents = checkData.items.filter((event: any) => event.status !== 'cancelled')
          isGoogleCalendarLinked = true
        }
      } catch (calErr: any) {
        console.warn('[SLOTS API] Failed to fetch Google Calendar events:', calErr.message)
      }
    }

    // Fetch busy windows from DB fallback (other booked leads)
    const { data: dbLeads, error: dbErr } = await supabaseAdmin
      .from('leads')
      .select('id, name, booked_time')
      .eq('user_id', profileId)
      .not('booked_time', 'is', null)
      .neq('id', leadId) // Exclude current lead's current booking

    if (dbErr) {
      console.error('[SLOTS API] DB query failed:', dbErr.message)
    }

    const now = new Date()

    for (let m = startMinutes; m + duration <= endMinutes; m += duration) {
      const slotHour = Math.floor(m / 60)
      const slotMinute = m % 60
      const timeStr = `${String(slotHour).padStart(2, '0')}:${String(slotMinute).padStart(2, '0')}`
      
      const slotStart = getUtcFromLocalTime(dateQuery, timeStr, timeZone)
      const slotEnd = new Date(slotStart.getTime() + duration * 60000)

      // Skip past slots
      if (slotStart < now) {
        continue
      }

      let isAvailable = true

      // Check Google Calendar overlap
      if (isGoogleCalendarLinked && googleEvents.length > 0) {
        const overlapsGoogle = googleEvents.some((event: any) => {
          const eStart = new Date(event.start.dateTime || event.start.date)
          const eEnd = new Date(event.end.dateTime || event.end.date)
          return (eStart < slotEnd && eEnd > slotStart)
        })
        if (overlapsGoogle) {
          isAvailable = false
        }
      }

      // Check DB fallback overlap
      if (isAvailable && dbLeads && dbLeads.length > 0) {
        const overlapsDb = dbLeads.some((other: any) => {
          const otherStart = new Date(other.booked_time)
          const otherEnd = new Date(otherStart.getTime() + duration * 60000)
          return (otherStart < slotEnd && otherEnd > slotStart)
        })
        if (overlapsDb) {
          isAvailable = false
        }
      }

      // Format simple UI label
      const formattedLabel = slotStart.toLocaleTimeString('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })

      slots.push({
        time: slotStart.toISOString(),
        label: formattedLabel,
        available: isAvailable
      })
    }

    return NextResponse.json({ slots })
  } catch (error: any) {
    console.error('[SLOTS API] Exception:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
