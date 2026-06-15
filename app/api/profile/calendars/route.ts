import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { refreshGoogleAccessToken } from '@/utils/google-calendar'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 })
  }

  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('google_refresh_token')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) throw profileError
    if (!profile || !profile.google_refresh_token) {
      return NextResponse.json({ calendars: [] })
    }

    const accessToken = await refreshGoogleAccessToken(profile.google_refresh_token)

    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    const data = await res.json()
    if (data.error) {
      throw new Error(data.error.message || "Failed to fetch calendar list")
    }

    const calendars = (data.items || []).map((item: any) => ({
      id: item.id,
      summary: item.summary,
      primary: !!item.primary
    }))

    return NextResponse.json({ calendars })

  } catch (error: any) {
    console.error("[Google Fetch Calendars API] Error:", error)
    return NextResponse.json({ error: error.message || "Failed to load calendars" }, { status: 500 })
  }
}
