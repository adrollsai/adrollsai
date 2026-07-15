import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const authHeader = request.headers.get('Authorization')
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)

    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      console.warn('[CRON REMINDERS] Unauthorized access attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[CRON REMINDERS Dispatcher] Running booking reminders check...')

    const now = new Date()

    // 1. Fetch all leads with active future bookings
    const { data: leads, error: leadsErr } = await supabaseAdmin
      .from('leads')
      .select('id, booked_time, reminder_24h_sent, reminder_4h_sent, reminder_1h_sent, reminder_15m_sent, custom_fields')
      .not('booked_time', 'is', null)
      .gt('booked_time', now.toISOString())

    if (leadsErr) throw leadsErr

    if (!leads || leads.length === 0) {
      return NextResponse.json({ success: true, message: 'No future appointments found.' })
    }

    // 2. Identify leads that need a reminder right now
    const leadsToQueue: { id: string; type: '24h' | '4h' | '1h' | '15m' }[] = []

    for (const lead of leads) {
      // Handle reschedule checking
      let customFields = lead.custom_fields || {}
      if (typeof customFields === 'string') {
        try {
          customFields = JSON.parse(customFields)
        } catch (e) {
          customFields = {}
        }
      }

      if (customFields.last_notified_booked_time && customFields.last_notified_booked_time !== lead.booked_time) {
        // Appointment rescheduled! Reset reminder statuses
        lead.reminder_24h_sent = false
        lead.reminder_4h_sent = false
        lead.reminder_1h_sent = false
        lead.reminder_15m_sent = false
        customFields.last_notified_booked_time = lead.booked_time

        await supabaseAdmin
          .from('leads')
          .update({
            reminder_24h_sent: false,
            reminder_4h_sent: false,
            reminder_1h_sent: false,
            reminder_15m_sent: false,
            custom_fields: customFields
          })
          .eq('id', lead.id)
      } else if (!customFields.last_notified_booked_time) {
        customFields.last_notified_booked_time = lead.booked_time
        await supabaseAdmin
          .from('leads')
          .update({ custom_fields: customFields })
          .eq('id', lead.id)
      }

      const bookedTime = new Date(lead.booked_time!)
      const diffMs = bookedTime.getTime() - now.getTime()
      const diffMins = Math.floor(diffMs / 60000)

      if (diffMins <= 1440 && diffMins > 240 && !lead.reminder_24h_sent) {
        leadsToQueue.push({ id: lead.id, type: '24h' })
      } else if (diffMins <= 240 && diffMins > 60 && !lead.reminder_4h_sent) {
        leadsToQueue.push({ id: lead.id, type: '4h' })
      } else if (diffMins <= 60 && diffMins > 15 && !lead.reminder_1h_sent) {
        leadsToQueue.push({ id: lead.id, type: '1h' })
      } else if (diffMins <= 15 && diffMins > 0 && !lead.reminder_15m_sent) {
        leadsToQueue.push({ id: lead.id, type: '15m' })
      }
    }

    if (leadsToQueue.length === 0) {
      return NextResponse.json({ success: true, message: 'No reminders due for sending at this time.' })
    }

    console.log(`[CRON REMINDERS Dispatcher] Queueing ${leadsToQueue.length} reminders in QStash...`)

    const qstashToken = process.env.QSTASH_TOKEN
    if (!qstashToken) {
      console.error('[CRON REMINDERS Dispatcher] QSTASH_TOKEN environment variable is not configured.')
      return NextResponse.json({ error: 'QStash not configured' }, { status: 500 })
    }

    // Construct the destination worker URL dynamically
    const workerUrl = `${url.origin}/api/cron/booking-reminders/worker`
    const publishPromises = leadsToQueue.map(async (item) => {
      const qstashPublishUrl = `https://qstash.upstash.io/v2/publish/${workerUrl}`
      
      const res = await fetch(qstashPublishUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Forward-Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
        },
        body: JSON.stringify({ id: item.id, type: item.type })
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error(`[CRON REMINDERS Dispatcher] Failed to queue lead ${item.id}:`, errText)
      }
    })

    await Promise.all(publishPromises)
    console.log(`[CRON REMINDERS Dispatcher] Successfully queued ${leadsToQueue.length} tasks in QStash.`)

    return NextResponse.json({ success: true, queuedCount: leadsToQueue.length })
  } catch (error: any) {
    console.error('[CRON REMINDERS Dispatcher] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
