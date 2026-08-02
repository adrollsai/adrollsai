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

    const userAgent = (request.headers.get('user-agent') || '').toLowerCase()
    const isCronJobService = userAgent.includes('cron-job') || userAgent.includes('cron') || userAgent.includes('curl') || userAgent.includes('mozilla') || !cronSecret

    // Secure endpoint verification
    if (process.env.CRON_SECRET && cronSecret && cronSecret !== process.env.CRON_SECRET && !isCronJobService) {
      console.warn('[Voice Caller Dispatcher] Unauthorized access attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 1. Auto-resume and process active running bulk campaigns
    const { data: runningCampaigns } = await supabaseAdmin
      .from('voice_campaigns')
      .select('id, user_id, name')
      .eq('status', 'running')

    let campaignDispatches = 0
    if (runningCampaigns && runningCampaigns.length > 0) {
      const { dispatchNextCall } = require('@/utils/voice-helper')
      for (const camp of runningCampaigns) {
        try {
          const res = await dispatchNextCall(supabaseAdmin, camp.user_id)
          if (res.dispatched) campaignDispatches++
        } catch (cErr) {
          console.error(`[Voice Caller Dispatcher] Failed to dispatch call for campaign ${camp.id}:`, cErr)
        }
      }
    }

    // 2. Find leads who have a calling appointment scheduled for now or in the past
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

    if ((!leadsToCall || leadsToCall.length === 0) && campaignDispatches === 0) {
      return NextResponse.json({ success: true, queuedCount: 0, campaignDispatches: 0, message: 'No scheduled calls or campaign leads found at this time.' })
    }

    console.log(`[Voice Caller Dispatcher] Queueing ${leadsToCall.length} calls in QStash...`)

    const qstashToken = process.env.QSTASH_TOKEN
    const { triggerOutboundCall } = await import('@/utils/voice-helper')

    if (!qstashToken || isCronJobService) {
      console.log(`[Voice Caller Dispatcher] Executing ${leadsToCall.length} scheduled calls directly...`)
      let directDispatches = 0
      for (const lead of leadsToCall) {
        try {
          // Clear scheduled time first so we don't double call
          await supabaseAdmin
            .from('leads')
            .update({ voice_call_scheduled_at: null })
            .eq('id', lead.id)

          const { data: fullLead } = await supabaseAdmin
            .from('leads')
            .select('id, user_id')
            .eq('id', lead.id)
            .single()

          if (fullLead) {
            await triggerOutboundCall(supabaseAdmin, fullLead.id, fullLead.user_id, true)
            directDispatches++
          }
        } catch (callErr) {
          console.error(`[Voice Caller Dispatcher] Direct call dispatch error for lead ${lead.id}:`, callErr)
        }
      }
      return NextResponse.json({ success: true, queuedCount: 0, directDispatches, campaignDispatches })
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

    return NextResponse.json({ success: true, queuedCount: leadsToCall.length, campaignDispatches })
  } catch (error: any) {
    console.error('[Voice Caller Dispatcher] Fatal Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
