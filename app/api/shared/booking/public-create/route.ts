import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { bookAppointment } from '@/utils/voice-helper'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { host_id, slot, name, email, phone } = body

    if (!host_id || !slot || !name || !email || !phone) {
      return NextResponse.json({ error: 'Missing required parameters: host_id, slot, name, email, phone' }, { status: 400 })
    }

    // 1. Resolve host profile
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(host_id)
    let profileQuery = supabaseAdmin
      .from('profiles')
      .select('id, business_name')
    
    if (isUuid) {
      profileQuery = profileQuery.eq('id', host_id)
    } else {
      profileQuery = profileQuery.eq('custom_domain', host_id)
    }

    const { data: profile, error: profileErr } = await profileQuery.maybeSingle()
    if (profileErr) throw profileErr
    if (!profile) {
      return NextResponse.json({ error: 'Host profile not found' }, { status: 404 })
    }

    // 2. Check if lead already exists for this host
    const { data: existingLead, error: leadFindErr } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('user_id', profile.id)
      .or(`email.eq.${email},phone.eq.${phone}`)
      .limit(1)
      .maybeSingle()

    if (leadFindErr) throw leadFindErr

    let leadId = ''
    if (existingLead) {
      leadId = existingLead.id
      // Update existing lead details if necessary
      await supabaseAdmin
        .from('leads')
        .update({ name, email, phone })
        .eq('id', leadId)
    } else {
      // Create new lead
      const { data: newLead, error: leadCreateErr } = await supabaseAdmin
        .from('leads')
        .insert({
          name,
          email,
          phone,
          user_id: profile.id,
          pipeline_stage: 'Appointment booked'
        })
        .select('id')
        .single()

      if (leadCreateErr) throw leadCreateErr
      leadId = newLead.id
    }

    // 3. Book the appointment using bookAppointment helper (it handles Google Calendar and Meet links)
    console.log(`[PUBLIC BOOKING API] Booking slot ${slot} for lead ${leadId}...`)
    const res = await bookAppointment(supabaseAdmin, leadId, slot, profile.id)

    if (!res.success) {
      return NextResponse.json({ error: res.error || 'Slot is already taken or unavailable' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      leadId,
      meetLink: res.meetLink,
      bookedTime: slot
    })

  } catch (error: any) {
    console.error('[PUBLIC BOOKING API] Exception:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
