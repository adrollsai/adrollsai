import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const leadId = searchParams.get('leadId')

        let body: any = {}
        const contentType = req.headers.get('content-type') || ''

        if (contentType.includes('application/json')) {
            body = await req.json().catch(() => ({}))
        } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
            const formData = await req.formData().catch(() => null)
            if (formData) {
                body = Object.fromEntries(formData.entries())
            }
        }

        const callStatus = (body.CallStatus || body.call_status || body.event || body.Status || '').toLowerCase()
        const callDuration = body.Duration || body.call_duration || body.duration || 0
        const callUuid = body.CallUUID || body.call_uuid || body.api_id || ''

        console.log(`[VOBIZ STATUS] Received status for lead ${leadId}: status=${callStatus}, duration=${callDuration}s, uuid=${callUuid}`)

        if (leadId) {
            // Map Vobiz status to our internal CRM status
            let updatedStatus: string | null = null
            if (['in-progress', 'answered'].includes(callStatus)) {
                updatedStatus = 'calling'
            } else if (['completed', 'hangup', 'stopped'].includes(callStatus)) {
                updatedStatus = 'completed'
            } else if (['busy', 'no-answer', 'timeout', 'rejected'].includes(callStatus)) {
                updatedStatus = 'no_answer'
            } else if (['failed', 'cancelled'].includes(callStatus)) {
                updatedStatus = 'failed'
            }

            if (updatedStatus) {
                const updatePayload: any = { voice_call_status: updatedStatus }
                if (callDuration > 0) {
                    updatePayload.voice_call_duration = parseInt(callDuration, 10)
                }

                await supabaseAdmin
                    .from('leads')
                    .update(updatePayload)
                    .eq('id', leadId)
            }
        }

        return NextResponse.json({ success: true })
    } catch (err: any) {
        console.error('[VOBIZ STATUS] Error handling callback:', err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
