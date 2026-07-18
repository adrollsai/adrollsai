import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
    const now = new Date()
    const targetTime = new Date(now.getTime() + 35 * 60 * 1000) // 35 minutes from now

    // 1. Fetch leads due for CRM follow-up alert
    const { data: leadsToRemind, error: followupErr } = await supabaseAdmin
      .from('leads')
      .select('id')
      .not('next_followup', 'is', null)
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

    console.log(`[Reminders Dispatcher] Queueing ${tasksToQueue.length} tasks in QStash...`)

    const qstashToken = process.env.QSTASH_TOKEN
    if (!qstashToken) {
      console.error('[Reminders Dispatcher] QSTASH_TOKEN environment variable is not configured.')
      return NextResponse.json({ error: 'QStash not configured' }, { status: 500 })
    }

    // Construct the destination worker URL dynamically
    const workerUrl = `${url.origin}/api/cron/reminders/worker`
    const publishPromises = tasksToQueue.map(async (item) => {
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
        console.error(`[Reminders Dispatcher] Failed to queue task ${item.id}:`, errText)
      }
    })

    await Promise.all(publishPromises)
    console.log(`[Reminders Dispatcher] Successfully queued ${tasksToQueue.length} tasks in QStash.`)

    return NextResponse.json({ success: true, queuedCount: tasksToQueue.length })
  } catch (error: any) {
    console.error('[Reminders Dispatcher] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}