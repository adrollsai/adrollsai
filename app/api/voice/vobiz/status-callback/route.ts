import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchNextCall } from '@/utils/voice-helper'
import { deductCredits, CREDIT_COSTS } from '@/utils/credits'
import { fetchVobizCallRecording } from '@/utils/vobiz-helper'

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
        const rawDuration = body.Duration || body.call_duration || body.duration || 0
        const callDuration = parseInt(rawDuration, 10) || 0
        const callUuid = body.CallUUID || body.call_uuid || body.api_id || ''
        let recordingUrl = body.RecordingUrl || body.recording_url || body.RecordUrl || body.recording_url_mp3 || body.RecordingURL || ''

        if (!recordingUrl && callUuid && ['completed', 'hangup', 'stopped'].includes(callStatus)) {
            try {
                const fetchedRec = await fetchVobizCallRecording(callUuid)
                if (fetchedRec) recordingUrl = fetchedRec
            } catch (fErr) {
                console.warn('[VOBIZ STATUS] Fallback recording fetch error:', fErr)
            }
        }

        console.log(`[VOBIZ STATUS] Received status for lead ${leadId}: status=${callStatus}, duration=${callDuration}s, uuid=${callUuid}, recording=${recordingUrl}`)

        if (leadId) {
            // Fetch lead details
            const { data: lead } = await supabaseAdmin
                .from('leads')
                .select('id, user_id, name, phone, voice_call_status, voice_recording_url, custom_fields')
                .eq('id', leadId)
                .single()

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

            const updatePayload: any = {}
            if (updatedStatus) {
                updatePayload.voice_call_status = updatedStatus
            }
            if (callDuration > 0) {
                updatePayload.voice_call_duration = callDuration
            }
            if (recordingUrl) {
                updatePayload.voice_recording_url = recordingUrl
            }

            if (Object.keys(updatePayload).length > 0) {
                await supabaseAdmin
                    .from('leads')
                    .update(updatePayload)
                    .eq('id', leadId)

                // If recordingUrl is present, update the latest lead_history remark
                if (recordingUrl) {
                    try {
                        const { data: latestHistory } = await supabaseAdmin
                            .from('lead_history')
                            .select('id, description')
                            .eq('lead_id', leadId)
                            .eq('action_type', 'REMARK')
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .maybeSingle()

                        if (latestHistory && latestHistory.description?.startsWith('🎙️ CALL_JSON:')) {
                            const rawJson = latestHistory.description.replace('🎙️ CALL_JSON:', '').trim()
                            const parsed = JSON.parse(rawJson)
                            parsed.recording_url = recordingUrl
                            await supabaseAdmin
                                .from('lead_history')
                                .update({ description: `🎙️ CALL_JSON:${JSON.stringify(parsed)}` })
                                .eq('id', latestHistory.id)
                        }
                    } catch (rErr) {
                        console.warn('[VOBIZ STATUS] Failed to update recording in history:', rErr)
                    }
                }

                // If call finished (completed, failed, or no_answer)
                if (['completed', 'no_answer', 'failed'].includes(updatedStatus || '') && lead) {
                    let cf: any = lead.custom_fields || {}
                    if (typeof cf === 'string') {
                        try { cf = JSON.parse(cf) } catch (e) { cf = {} }
                    }
                    const isTestCall = cf.skip_credit_deduction || cf.is_test_call || lead.phone === '+918288835235'

                    if (isTestCall) {
                        console.log(`[VOBIZ STATUS] 🧪 Test call detected for lead ${lead.id} (${lead.phone}). Skipping credit deduction.`)
                    } else if (callDuration > 0 && updatedStatus === 'completed') {
                        // Connected call: 5 credits per minute (rounded up to nearest minute)
                        const billableMinutes = Math.ceil(callDuration / 60)
                        const totalCredits = billableMinutes * CREDIT_COSTS.VOICE_CALL_MINUTE
                        deductCredits(
                            supabaseAdmin,
                            lead.user_id,
                            totalCredits,
                            'calling',
                            `🎙️ AI Voice Call to ${lead.name || lead.phone || 'lead'} (${callDuration}s - ${billableMinutes} min)`
                        ).catch(e => console.error('[VOBIZ STATUS] Credit deduction error:', e))
                    } else {
                        // Unconnected call (no answer, busy, failed, or 0 duration): 0.02 credits
                        const unconnectedCredits = CREDIT_COSTS.VOICE_CALL_UNCONNECTED || 0.02
                        deductCredits(
                            supabaseAdmin,
                            lead.user_id,
                            unconnectedCredits,
                            'calling',
                            `📞 Outbound Call Attempt (Unconnected / ${updatedStatus || 'No Answer'}) to ${lead.name || lead.phone || 'lead'}`
                        ).catch(e => console.error('[VOBIZ STATUS] Unconnected credit deduction error:', e))
                    }

                    // Advance queue by dispatching the next pending/queued call for this user (skip on test calls)
                    if (!isTestCall) {
                        setTimeout(() => {
                            dispatchNextCall(supabaseAdmin, lead.user_id).catch(dErr => {
                                console.error('[VOBIZ STATUS] Error dispatching next call:', dErr)
                            })
                        }, 1000)
                    }
                }
            }
        }

        return NextResponse.json({ success: true })
    } catch (err: any) {
        console.error('[VOBIZ STATUS] Error handling callback:', err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
