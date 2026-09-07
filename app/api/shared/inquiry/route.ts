import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { 
      name, 
      phone, 
      email, 
      message, 
      user_id, 
      source = 'Website Consultation Form' 
    } = body

    if (!name || !phone || !user_id) {
      return NextResponse.json({ error: 'Missing required contact details (name, phone, user_id).' }, { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Clean phone number
    const cleanPhone = phone.replace(/[^0-9+]/g, '').trim()

    // 1. Insert lead record into public.leads
    const { data: newLead, error: insertError } = await supabaseAdmin
      .from('leads')
      .insert({
        user_id,
        name: name.trim(),
        phone: cleanPhone,
        email: email ? email.trim() : null,
        source,
        stage: 'New Lead',
        notes: message ? `Website Inquiry: ${message}` : 'Inquiry submitted from connected website',
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (insertError) {
      console.error('[Shared Inquiry API] DB Insert Error:', insertError)
      return NextResponse.json({ error: 'Failed to record consultation request' }, { status: 500 })
    }

    // 2. Dispatch push notification to user
    try {
      await sendPushNotification(
        user_id,
        '🌟 New Website Lead Received!',
        `${name.trim()} submitted an inquiry from your website. Phone: ${cleanPhone}`,
        `/dashboard/crm`
      )
    } catch (notifErr) {
      console.warn('[Shared Inquiry API] Push notification failed:', notifErr)
    }

    return NextResponse.json({
      success: true,
      message: 'Inquiry recorded successfully',
      leadId: newLead.id
    })

  } catch (err: any) {
    console.error('[Shared Inquiry API] Server error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
