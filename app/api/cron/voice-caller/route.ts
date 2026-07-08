import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { triggerOutboundCall } from '@/utils/voice-helper'

// Bypasses static build cache for Vercel deployment
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

export async function GET(request: Request) {
    return handleVoiceCaller(request)
}

export async function POST(request: Request) {
    return handleVoiceCaller(request)
}

async function handleVoiceCaller(request: Request) {
    const diagnostics: Record<string, any> = {
        timestamp: new Date().toISOString(),
        processedLeads: [],
        errors: []
    }

    try {
        const url = new URL(request.url)
        const authHeader = request.headers.get('Authorization')
        const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)

        console.log(`[Voice Caller Cron] Triggered at ${diagnostics.timestamp}`)

        // Secure endpoint verification
        if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
            console.warn(`[Voice Caller Cron] Unauthorized access attempt.`)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: { persistSession: false }
            }
        )

        // Find leads who have a calling appointment scheduled for now or in the past,
        // are not currently active in a call, and are not in Won/Booked stage
        const nowUtc = new Date().toISOString()
        const { data: leadsToCall, error: dbError } = await supabaseAdmin
            .from('leads')
            .select('id, user_id, name, phone, voice_call_status, pipeline_stage')
            .not('voice_call_scheduled_at', 'is', null)
            .lte('voice_call_scheduled_at', nowUtc)
            .neq('voice_call_status', 'calling')
            .not('pipeline_stage', 'in', '("Won", "Appointment booked")')

        if (dbError) throw dbError

        if (!leadsToCall || leadsToCall.length === 0) {
            return NextResponse.json({
                success: true,
                processedCount: 0,
                message: 'No scheduled calls found at this time.',
                diagnostics
            })
        }

        console.log(`[Voice Caller Cron] Found ${leadsToCall.length} leads to call. Processing...`)

        const callResults = []
        for (const lead of leadsToCall) {
            try {
                // Clear the scheduled time first so it doesn't get double called if execution runs long
                await supabaseAdmin
                    .from('leads')
                    .update({ voice_call_scheduled_at: null })
                    .eq('id', lead.id)

                const result = await triggerOutboundCall(supabaseAdmin, lead.id, lead.user_id)
                
                // If outbound call failed to initiate, restore scheduled time for retry check or log failure
                if (!result.success) {
                    console.error(`[Voice Caller Cron] Call failed to initiate for lead ${lead.id}:`, result.error)
                    diagnostics.errors.push({ leadId: lead.id, error: result.error })
                    
                    // We mark call as failed in DB
                    await supabaseAdmin
                        .from('leads')
                        .update({ voice_call_status: 'failed' })
                        .eq('id', lead.id)
                }

                callResults.push({
                    leadId: lead.id,
                    name: lead.name,
                    success: result.success,
                    callSid: result.callSid,
                    error: result.error
                })
            } catch (leadErr: any) {
                console.error(`[Voice Caller Cron] Exception processing lead ${lead.id}:`, leadErr.message)
                diagnostics.errors.push({ leadId: lead.id, error: leadErr.message })
            }
        }

        diagnostics.processedLeads = callResults

        return NextResponse.json({
            success: true,
            processedCount: callResults.length,
            results: callResults,
            diagnostics
        })
    } catch (err: any) {
        console.error(`[Voice Caller Cron] Handler Exception:`, err.message)
        return NextResponse.json({
            success: false,
            error: err.message,
            diagnostics
        }, { status: 500 })
    }
}
