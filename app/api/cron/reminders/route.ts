import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
    global: { fetch: fetch } 
  }
)

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const authHeader = request.headers.get('Authorization')
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)

    console.log('[Reminders Dispatcher] Running reminders check...')

    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      console.warn('[Reminders Dispatcher] Unauthorized access attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const nowUtcString = new Date().toISOString()
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const now = new Date()
    const targetTime = new Date(now.getTime() + 35 * 60 * 1000) // 35 minutes from now

    // 1. Fetch leads due for CRM follow-up alert (within recent 2-hour window)
    const { data: leadsToRemind, error: followupErr } = await supabaseAdmin
      .from('leads')
      .select('id, user_id, assigned_to')
      .not('next_followup', 'is', null)
      .gte('next_followup', twoHoursAgo)
      .lte('next_followup', nowUtcString)

    if (followupErr) throw followupErr

    // 2. Fetch leads due for 30-minute booking email
    const { data: bookingsToRemind, error: bookingErr } = await supabaseAdmin
      .from('leads')
      .select('id')
      .not('booked_time', 'is', null)
      .eq('booking_reminder_sent', false)
      .gte('booked_time', now.toISOString())
      .lte('booked_time', targetTime.toISOString())

    if (bookingErr) throw bookingErr

    const tasksToQueue: { id: string; type: 'followup' | 'booking_30m' }[] = []

    if (leadsToRemind) {
      leadsToRemind.forEach(lead => {
        tasksToQueue.push({ id: lead.id, type: 'followup' })
      })
    }

    if (bookingsToRemind) {
      bookingsToRemind.forEach(booking => {
        tasksToQueue.push({ id: booking.id, type: 'booking_30m' })
      })
    }

    // Asynchronously trigger the WhatsApp 24h followups scanner
    try {
      const followupUrl = `${url.origin}/api/cron/whatsapp-followup`
      console.log(`[Reminders Dispatcher] Triggering WhatsApp followups scanner at ${followupUrl}`)
      fetch(followupUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
        }
      }).catch(err => {
        console.error('[Reminders Dispatcher] WhatsApp followup trigger failed:', err)
      })
    } catch (followupErr: any) {
      console.error('[Reminders Dispatcher] Failed to trigger WhatsApp followups:', followupErr)
    }

    if (tasksToQueue.length === 0) {
      return NextResponse.json({ success: true, message: 'No reminders or followups due at this time.' })
    }

    // Process due followup push notifications directly
    for (const item of tasksToQueue) {
      if (item.type === 'followup') {
        const { data: lead } = await supabaseAdmin
          .from('leads')
          .select('id, user_id, assigned_to, name, phone, next_followup')
          .eq('id', item.id)
          .maybeSingle()

        if (lead && lead.next_followup) {
          const targetIds = Array.from(new Set([lead.assigned_to, lead.user_id].filter(Boolean)))
          for (const targetId of targetIds) {
            await sendPushNotification(
              targetId,
              "Follow-Up Reminder ⏰",
              `Time to follow up with ${lead.name || 'Lead'} ${lead.phone ? `(${lead.phone})` : ''}`,
              `/dashboard/crm/${lead.id}`,
              "reminder"
            ).catch((err: any) => console.error('[Reminders Dispatcher Push Error]:', err))
          }

          // Clear next_followup after sending push alert
          await supabaseAdmin.from('leads').update({ next_followup: null }).eq('id', lead.id)
        }
      }
    }

    return NextResponse.json({ success: true, processedCount: tasksToQueue.length })
  } catch (error: any) {
    console.error('[Reminders Dispatcher] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}