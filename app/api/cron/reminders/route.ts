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
      .select('id, user_id, assigned_to, name, phone, next_followup')
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

    if ((!leadsToRemind || leadsToRemind.length === 0) && (!bookingsToRemind || bookingsToRemind.length === 0)) {
      return NextResponse.json({ success: true, message: 'No reminders due at this time.' })
    }

    // Process due followup push notifications directly without N+1 queries
    const processedIds: string[] = []
    if (leadsToRemind && leadsToRemind.length > 0) {
      for (const lead of leadsToRemind) {
        if (lead.next_followup) {
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
          processedIds.push(lead.id)
        }
      }

      if (processedIds.length > 0) {
        await supabaseAdmin.from('leads').update({ next_followup: null }).in('id', processedIds)
      }
    }

    return NextResponse.json({ success: true, processedCount: processedIds.length })
  } catch (error: any) {
    console.error('[Reminders Dispatcher] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}