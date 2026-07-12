import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { triggerOutboundCall } from '@/utils/voice-helper'

// Bypasses static build cache for Vercel deployment
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300 // Allow enough execution time for call dispatch

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false }
  }
)

export async function POST(request: Request) {
  try {
    // Security check
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('[Voice Caller Worker] Unauthorized worker execution attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id: leadId } = body

    if (!leadId) {
      return NextResponse.json({ error: 'Missing parameter: id' }, { status: 400 })
    }

    console.log(`[Voice Caller Worker] Triggering call for lead ID: ${leadId}...`)

    // A. Fetch lead details
    const { data: lead, error: dbError } = await supabaseAdmin
      .from('leads')
      .select('id, user_id, name, phone, voice_call_status, pipeline_stage')
      .eq('id', leadId)
      .maybeSingle()

    if (dbError) throw dbError
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // Double check constraints (so we don't call if pipeline_stage became Won/Booked in the meantime)
    if (lead.voice_call_status === 'calling' || ['Won', 'Appointment booked'].includes(lead.pipeline_stage || '')) {
      console.log(`[Voice Caller Worker] Lead ${leadId} call constraints not met. Status: ${lead.voice_call_status}, Stage: ${lead.pipeline_stage}. Skipping.`)
      return NextResponse.json({ success: true, message: 'Skipped call due to stage or status constraints.' })
    }

    // B. Initiate Call
    // Clear scheduled time first so we don't double call
    await supabaseAdmin
      .from('leads')
      .update({ voice_call_scheduled_at: null })
      .eq('id', lead.id)

    const result = await triggerOutboundCall(supabaseAdmin, lead.id, lead.user_id, true)
    
    if (!result.success) {
      console.error(`[Voice Caller Worker] Call failed to initiate for lead ${lead.id}:`, result.error)
      // Mark call as failed in DB
      await supabaseAdmin
        .from('leads')
        .update({ voice_call_status: 'failed' })
        .eq('id', lead.id)
      
      throw new Error(result.error || 'Outbound call failed to initiate')
    }

    console.log(`[Voice Caller Worker] Call successfully initiated for lead ${lead.id}. SID: ${result.callSid}`)
    return NextResponse.json({ success: true, callSid: result.callSid })

  } catch (error: any) {
    console.error('[Voice Caller Worker] Execution failed:', error)
    return NextResponse.json({ error: error.message || 'Worker execution failed' }, { status: 500 })
  }
}
