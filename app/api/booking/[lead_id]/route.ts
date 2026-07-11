import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { bookAppointment, cancelAppointment } from '@/utils/voice-helper'
import { sendRescheduledEmail, sendCancellationEmail } from '@/utils/email-helper'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lead_id: string }> }
) {
  try {
    const { lead_id } = await params
    const leadId = lead_id
    const body = await request.json()
    const { action, slot } = body

    if (!action || !['reschedule', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Valid action ("reschedule" or "cancel") is required' }, { status: 400 })
    }

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

    // 2. Fetch Host Profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, email')
      .eq('id', lead.user_id)
      .maybeSingle()

    if (profileError) throw profileError
    if (!profile) {
      return NextResponse.json({ error: 'Host profile not found' }, { status: 404 })
    }

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
        console.warn('[BOOKING API] Failed to parse custom fields for email check:', e)
      }
    }

    if (action === 'reschedule') {
      if (!slot) {
        return NextResponse.json({ error: 'slot is required for rescheduling' }, { status: 400 })
      }

      console.log(`[BOOKING API] Rescheduling lead ${leadId} to slot ${slot}...`)
      const res = await bookAppointment(supabaseAdmin, leadId, slot, lead.user_id)

      if (!res.success) {
        return NextResponse.json({ error: res.error || 'Failed to book slot' }, { status: 400 })
      }

      // Send rescheduled confirmation email
      if (leadEmail) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
        const rescheduleLink = `${appUrl}/shared/booking/${leadId}?action=reschedule`
        const cancelLink = `${appUrl}/shared/booking/${leadId}?action=cancel`
        
        await sendRescheduledEmail(
          leadEmail,
          lead.name,
          slot,
          res.meetLink || '',
          rescheduleLink,
          cancelLink,
          profile.business_name || 'Our Team'
        ).catch(e => console.error('[BOOKING API] Failed to send rescheduled email:', e))
      }

      return NextResponse.json({ success: true, meetLink: res.meetLink })
    }

    if (action === 'cancel') {
      console.log(`[BOOKING API] Cancelling appointment for lead ${leadId}...`)
      const res = await cancelAppointment(supabaseAdmin, leadId)

      if (!res.success) {
        return NextResponse.json({ error: res.error || 'Failed to cancel appointment' }, { status: 400 })
      }

      // Send cancellation email
      if (leadEmail) {
        await sendCancellationEmail(
          leadEmail,
          lead.name,
          profile.business_name || 'Our Team'
        ).catch(e => console.error('[BOOKING API] Failed to send cancellation email:', e))
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action state' }, { status: 400 })
  } catch (error: any) {
    console.error('[BOOKING API] POST Exception:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
