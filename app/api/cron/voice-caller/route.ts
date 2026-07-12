import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Bypasses static build cache for Vercel deployment
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false }
  }
)

export async function GET(request: Request) {
  return handleVoiceCallerDispatcher(request)
}

export async function POST(request: Request) {
  return handleVoiceCallerDispatcher(request)
}

async function handleVoiceCallerDispatcher(request: Request) {
  try {
    const url = new URL(request.url)
    const authHeader = request.headers.get('Authorization')
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)

    console.log('[Voice Caller Dispatcher] Checking scheduled calls...')

    // Secure endpoint verification
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      console.warn('[Voice Caller Dispatcher] Unauthorized access attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find leads who have a calling appointment scheduled for now or in the past,
    // are not currently active in a call, and are not in Won/Booked stage
    const nowUtc = new Date().toISOString()
    const { data: leadsToCall, error: dbError } = await supabaseAdmin
      .from('leads')
      .select('id')
      .not('voice_call_scheduled_at', 'is', null)
      .lte('voice_call_scheduled_at', nowUtc)
      .neq('voice_call_status', 'calling')
      .neq('voice_call_status', 'failed')
      .neq('calling_enabled', false)
      .not('pipeline_stage', 'in', '("Won", "Appointment booked")')

    if (dbError) throw dbError

    if (!leadsToCall || leadsToCall.length === 0) {
      return NextResponse.json({ success: true, queuedCount: 0, message: 'No scheduled calls found at this time.' })
    }

    console.log(`[Voice Caller Dispatcher] Queueing ${leadsToCall.length} calls in QStash...`)

    const qstashToken = process.env.QSTASH_TOKEN
    if (!qstashToken) {
      console.error('[Voice Caller Dispatcher] QSTASH_TOKEN environment variable is not configured.')
      return NextResponse.json({ error: 'QStash not configured' }, { status: 500 })
    }

    // Construct the destination worker URL dynamically
    const workerUrl = `${url.origin}/api/cron/voice-caller/worker`
    const publishPromises = leadsToCall.map(async (lead) => {
      const qstashPublishUrl = `https://qstash.upstash.io/v2/publish/${workerUrl}`
      
      const res = await fetch(qstashPublishUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Forward-Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
        },
        body: JSON.stringify({ id: lead.id })
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error(`[Voice Caller Dispatcher] Failed to queue lead ${lead.id}:`, errText)
      }
    })

    await Promise.all(publishPromises)
    console.log(`[Voice Caller Dispatcher] Successfully queued ${leadsToCall.length} tasks in QStash.`)

    return NextResponse.json({ success: true, queuedCount: leadsToCall.length })
  } catch (error: any) {
    console.error('[Voice Caller Dispatcher] Fatal Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
