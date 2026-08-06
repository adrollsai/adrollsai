import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { bookAppointment } from '@/utils/voice-helper'
import { sendCAPIEvent } from '@/utils/external-apis'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { lead_id, slot, user_id, eventId } = body

    if (!lead_id || !slot || !user_id) {
      return NextResponse.json({ error: "Missing required parameters: lead_id, slot, user_id" }, { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Book appointment using central helper (handles Google Calendar, Meet link, Emails, Admin alerts, and WhatsApp confirmations)
    console.log(`[Shared Booking API] Booking slot ${slot} for lead ${lead_id}...`)
    const res = await bookAppointment(supabaseAdmin, lead_id, slot, user_id, true)

    if (!res.success) {
      return NextResponse.json({ error: res.error || "Slot is already taken or unavailable" }, { status: 400 })
    }

    // Fetch lead details for CAPI Event tracking
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle()

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('facebook_token, selected_page_token, pixel_id')
      .eq('id', user_id)
      .maybeSingle()

    // Trigger Conversions API (CAPI) Schedule Event
    const pixelId = lead?.pixel_id || profile?.pixel_id
    const fbToken = profile?.facebook_token || profile?.selected_page_token
    if (pixelId && fbToken && lead) {
      const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
                       request.headers.get('x-real-ip') || 
                       '127.0.0.1';
      const clientUa = request.headers.get('user-agent') || '';
      const sourceUrl = request.headers.get('referer') || '';
      
      const nameParts = (lead.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      console.log(`[CAPI Schedule] Dispatching Schedule event to Meta CAPI for Pixel: ${pixelId}`)
      sendCAPIEvent(
        fbToken,
        pixelId,
        'Schedule',
        {
          email: lead.email || undefined,
          phone: lead.phone,
          firstName: firstName,
          lastName: lastName,
          externalId: lead.id
        },
        0,
        clientIp,
        clientUa,
        sourceUrl,
        eventId
      ).catch(err => {
        console.error("[CAPI Schedule] Failed to send CAPI Schedule event:", err)
      })
    }

    console.log(`[Shared Booking API] Successfully booked slot ${slot} for Lead ID: ${lead_id}`)

    return NextResponse.json({ success: true, meetLink: res.meetLink })

  } catch (error: any) {
    console.error("[Shared Booking Create API] Error:", error)
    return NextResponse.json({ error: error.message || "Failed to book appointment" }, { status: 500 })
  }
}
