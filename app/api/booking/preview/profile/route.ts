import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const hostId = searchParams.get('host_id')

    if (!hostId) {
      return NextResponse.json({ error: 'Missing host_id' }, { status: 400 })
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hostId)
    let query = supabaseAdmin
      .from('profiles')
      .select('id, business_name, logo_url, brand_color, google_booking_duration, google_booking_enabled')

    if (isUuid) {
      query = query.eq('id', hostId)
    } else {
      query = query.or(`custom_domain.eq.${hostId},business_name.ilike.${hostId}`)
    }

    const { data: profile, error } = await query.maybeSingle()

    if (error) {
      console.error('[API BOOKING PROFILE] Query Error:', error)
      return NextResponse.json({ error: 'Failed to fetch host profile' }, { status: 500 })
    }

    if (!profile) {
      return NextResponse.json({ error: 'Booking profile not found' }, { status: 404 })
    }

    return NextResponse.json({ profile }, { status: 200 })
  } catch (err: any) {
    console.error('[API BOOKING PROFILE] Exception:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
