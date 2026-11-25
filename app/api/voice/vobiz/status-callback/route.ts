import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchNextCall } from '@/utils/voice-helper'
import { deductCredits, CREDIT_COSTS } from '@/utils/credits'
import { callChargeCredits } from '@/lib/automation/call-billing'
import { fetchVobizCallRecording } from '@/utils/vobiz-helper'
import { ensureStandardMp3 } from '@/utils/audio-transcode'
import { storeRecording } from '@/lib/automation/recording-store'
import { attachRecordingToCallLog } from '@/lib/automation/call-log-sync'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    return handleStatusCallback(req)
}

export async function POST(req: Request) {
    return handleStatusCallback(req)
}

async function handleStatusCallback(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const leadId = searchParams.get('leadId')

        let body: any = {}
        const contentType = req.headers.get('content-type') || ''

        try {
            if (contentType.includes('application/json')) {
                body = await req.json().catch(() => ({}))
            } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
                const formData = await req.formData().catch(() => null)
                if (formData) {
                    body = Object.fromEntries(formData.entries())
                }
            } else {
                const rawText = await req.text().catch(() => '')
                try {
                    body = JSON.parse(rawText)
                } catch {
                    body = Object.fromEntries(new URLSearchParams(rawText).entries())
                }
            }
        } catch (parseErr) {
            console.warn('[VOBIZ STATUS] Body parse error:', parseErr)
        }

        const callStatus = (body.CallStatus || body.call_status || body.event || body.Status || searchParams.get('event') || '').toLowerCase()
        const rawDuration = body.Duration || body.call_duration || body.duration || 0
        const callDuration = parseInt(rawDuration, 10) || 0
        const callUuid = body.CallUUID || body.call_uuid || body.api_id || searchParams.get('callUuid') || searchParams.get('call_uuid') || ''
        let recordingUrl = body.RecordFile || body.RecordUrl || body.record_url || body.RecordingUrl || body.recording_url || body.recording_url_mp3 || body.RecordingURL || body.recordingUrl || body.url || ''

        if (!recordingUrl) {
            recordingUrl = searchParams.get('RecordFile') || searchParams.get('RecordingUrl') || searchParams.get('recording_url') || searchParams.get('RecordUrl') || searchParams.get('record_url') || ''
        }

        // Fetch lead and account profile to resolve correct Vobiz sub-account credentials
        let lead: any = null
        let authId = searchParams.get('vobizAuthId') || process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
        let authToken = searchParams.get('vobizAuthToken') || process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'

        if (leadId) {
            const { data: leadData } = await supabaseAdmin
                .from('leads')
                .select('id, user_id, name, phone, voice_call_status, voice_recording_url, custom_fields')
                .eq('id', leadId)
                .single()
            lead = leadData

            if (lead?.user_id && !searchParams.get('vobizAuthId')) {
                try {
                    const { data: prof } = await supabaseAdmin
                        .from('profiles')
                        .select('business_info')
                        .eq('id', lead.user_id)
                        .maybeSingle()
                    const bi = typeof prof?.business_info === 'string' ? JSON.parse(prof.business_info) : (prof?.business_info || {})
                    authId = bi?.voice_vobiz_auth_id || bi?.kyc_data?.vobizSubAuthId || authId
                    authToken = bi?.voice_vobiz_auth_token || authToken
                } catch (profErr) {
                    console.warn('[VOBIZ STATUS] Error loading profile for auth credentials:', profErr)
                }
            }
        }

        if (!recordingUrl && callUuid && ['completed', 'hangup', 'stopped', 'recording', 'recordstop'].includes(callStatus)) {
            // Actively fetch recording from Vobiz Recording API with retries using correct sub-account credentials
            for (let recAttempt = 1; recAttempt <= 3; recAttempt++) {
                try {
                    const waitMs = recAttempt === 1 ? 3000 : 5000
                    await new Promise(r => setTimeout(r, waitMs))
                    const fetchedRec = await fetchVobizCallRecording(callUuid, { authId, authToken })
                    if (fetchedRec) {
                        recordingUrl = fetchedRec
                        console.log(`[VOBIZ STATUS] Found recording URL on attempt ${recAttempt}: ${recordingUrl}`)
                        break
                    }
                    console.log(`[VOBIZ STATUS] Recording not ready yet (attempt ${recAttempt}/3)...`)
                } catch (fErr: any) {
                    console.warn(`[VOBIZ STATUS] Recording fetch attempt ${recAttempt} error:`, fErr.message)
                }
            }
        }

        console.log(`[VOBIZ STATUS] Received status for lead ${leadId}: status=${callStatus}, duration=${callDuration}s, uuid=${callUuid}, recording=${recordingUrl}`)

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

            const updatePayload: any = {}
            if (updatedStatus) {
                updatePayload.voice_call_status = updatedStatus
            }

            // Automated follow-up retry scheduling for unanswered / busy / failed calls (Infinite Decaying Cadence)
            if (['no_answer', 'failed'].includes(updatedStatus || '')) {
                try {
                    const { data: currentLead } = await supabaseAdmin
                        .from('leads')
                        .select('id, voice_call_retry_count, pipeline_stage, status, notes, custom_fields, calling_enabled')
                        .eq('id', leadId)
                        .single()

                    let cf: any = currentLead?.custom_fields || {}
                    if (typeof cf === 'string') {
                        try { cf = JSON.parse(cf) } catch (e) { cf = {} }
                    }

                    // Check if lead has explicitly opted out or is disabled
                    const isOptedOut = currentLead?.calling_enabled === false || cf.calling_enabled === false || cf.is_interested === false
                    const terminalStages = ['Won', 'Lost', 'Lost/NI', 'Deal/Token', 'Appointment Booked', 'Disqualified', 'Wrong Number', 'Do Not Call']
                    const isTerminalStage = terminalStages.some(s => (currentLead?.pipeline_stage || '').toLowerCase().includes(s.toLowerCase()))

                    if (isOptedOut || isTerminalStage) {
                        updatePayload.voice_call_status = 'no_answer'
                        updatePayload.voice_call_scheduled_at = null
                        console.log(`[VOBIZ STATUS] Lead ${leadId} has opted out or reached terminal stage. Retry skipped.`)
                    } else {
                        const currentRetries = currentLead?.voice_call_retry_count || 0
                        const nextRetryCount = currentRetries + 1

                        const { computeNextRetrySlot } = await import('@/utils/calling-window')
                        const validSlot = computeNextRetrySlot(nextRetryCount, new Date(), 'Asia/Kolkata')
                        const scheduledTime = validSlot.toISOString()

                        updatePayload.voice_call_status = 'scheduled_retry'
                        updatePayload.voice_call_scheduled_at = scheduledTime
                        updatePayload.voice_call_retry_count = nextRetryCount

                        // CRITICAL: Keep lead in Fresh section so human tele-callers can also see them!
                        if (!currentLead?.pipeline_stage || currentLead.pipeline_stage === 'New' || currentLead.pipeline_stage === 'New Lead') {
                            updatePayload.pipeline_stage = 'New Lead'
                            updatePayload.status = 'New Lead'
                        }

                        let updatedNotes = `[⚠️ Call Rescheduled]: Automated follow-up retry #${nextRetryCount} scheduled for ${validSlot.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST (Reason: ${callStatus})`
                        if (currentLead?.notes) {
                            updatedNotes += `\n\n${currentLead.notes}`
                        }
                        updatePayload.notes = updatedNotes

                        await supabaseAdmin
                            .from('lead_history')
                            .insert({
                                lead_id: leadId,
                                action_type: 'REMARK',
                                description: `⚠️ Outbound call was unanswered/busy (${callStatus}). Scheduled automated retry #${nextRetryCount} for ${validSlot.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.`
                            })
                        console.log(`[VOBIZ STATUS] Scheduled follow-up retry #${nextRetryCount} for lead ${leadId} at ${scheduledTime}`)
                    }
                } catch (retryErr: any) {
                    console.warn('[VOBIZ STATUS] Error scheduling follow-up retry:', retryErr.message)
                }
            }

            // If recordingUrl is present, archive it to R2 and store the object key so
            // playback always goes through a freshly minted URL.
            let publicRecordingUrl = recordingUrl
            if (recordingUrl) {
                try {
                    console.log(`[VOBIZ STATUS] Downloading audio from ${recordingUrl} with auth ${authId}...`)
                    const recFetchRes = await fetch(recordingUrl, {
                        headers: {
                            'X-Auth-ID': authId,
                            'X-Auth-Token': authToken
                        }
                    })

                    if (recFetchRes.ok) {
                        const rawBuffer = Buffer.from(await recFetchRes.arrayBuffer())
                        const audioBuffer = await ensureStandardMp3(rawBuffer)
                        const stored = await storeRecording({
                            leadId,
                            filename: `vobiz_${Date.now()}.mp3`,
                            body: audioBuffer,
                            contentType: 'audio/mpeg'
                        })

                        if (stored) {
                            publicRecordingUrl = stored.key
                            console.log(`[VOBIZ STATUS] Archived recording for lead ${leadId} to R2: ${stored.key}`)
                        } else {
                            console.warn(`[VOBIZ STATUS] R2 archive failed for lead ${leadId}; keeping the carrier URL`)
                        }
                    }
                } catch (sErr) {
                    console.warn('[VOBIZ STATUS] Error archiving recording to R2:', sErr)
                }
                updatePayload.voice_recording_url = publicRecordingUrl

                // The CRM call history reads call_logs, and nothing ever created a row there for a
                // Vobiz AI call — which is why the list is empty even when the audio was archived.
                // attachRecordingToCallLog updates the row for this call, or creates it.
                const callLogSync = await attachRecordingToCallLog(supabaseAdmin, {
                    leadId,
                    userId: (lead as any)?.user_id,
                    recording: publicRecordingUrl,
                    phoneNumber: (lead as any)?.phone,
                    startedAtIso: new Date(Date.now() - (callDuration || 0) * 1000).toISOString(),
                    durationSeconds: callDuration,
                })
                console.log(`[VOBIZ STATUS] call_logs recording ${callLogSync.action}${callLogSync.callLogId ? ' ' + callLogSync.callLogId : ''}${callLogSync.reason ? ' — ' + callLogSync.reason : ''}`)
            }

            // Persist the carrier's call uuid. Recordings frequently appear well after this callback
            // gives up (13 s), and without the uuid nothing can go back for them later.
            if (callUuid) {
                try {
                    const rawCf = (lead as any)?.custom_fields
                    let cf: any = {}
                    if (typeof rawCf === 'string') { try { cf = JSON.parse(rawCf || '{}') } catch { cf = {} } }
                    else if (rawCf && typeof rawCf === 'object') cf = rawCf
                    updatePayload.custom_fields = { ...cf, vobiz_call_uuid: callUuid, vobiz_recording_sweeps: 0 }
                } catch {
                    /* custom_fields is best-effort bookkeeping */
                }
            }

            updatePayload.last_call_at = new Date().toISOString()
            updatePayload.last_call_status = updatedStatus === 'completed' ? 'connected' : (['no_answer', 'busy'].includes(updatedStatus || '') ? 'no_answer' : 'failed')
            updatePayload.last_called_by = 'AI Caller'

            if (Object.keys(updatePayload).length > 0) {
                await supabaseAdmin
                    .from('leads')
                    .update(updatePayload)
                    .eq('id', leadId)

                // If recordingUrl is present, update the latest lead_history remark
                if (publicRecordingUrl) {
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
                            parsed.recording_url = publicRecordingUrl
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
                    const isTestCall = cf.skip_credit_deduction === true || 
                                       cf.is_test_call === true || 
                                       cf.is_demo_call === true || 
                                       cf.demo_call === true || 
                                       lead.source === 'AI Call Demo' || 
                                       lead.phone === '+918288835235' || 
                                       (lead.user_id === '68b55a31-a16d-454d-a20f-11adabf590b0' && (cf.is_demo_call || cf.is_test_call || cf.demo || lead.source === 'AI Call Demo'))

                    if (isTestCall) {
                        console.log(`[VOBIZ STATUS] 🧪 Test/Demo call detected for lead ${lead.id} (${lead.phone}). Skipping credit deduction — 0 credits charged to Bioque Estates.`)
                    } else if (callDuration > 0 && updatedStatus === 'completed') {
                        // Connected call, charged by the ONE billing model
                        // (lib/automation/call-billing.ts): 1 credit for each started minute block plus
                        // 0.05 credits per second, in integer hundredths, with the AI cost baked in.
                        //
                        // This used to be `Math.ceil(callDuration / 60) * VOICE_CALL_MINUTE` — a flat
                        // 5 credits per minute. That is a different tariff to the one specified, and
                        // this is the path REAL calls take, so fixing bill-call alone never reached
                        // production. The two must stay one calculation.
                        const totalCredits = callChargeCredits(callDuration)
                        deductCredits(
                            supabaseAdmin,
                            lead.user_id,
                            totalCredits,
                            'calling',
                            `🎙️ AI Voice Call to ${lead.name || lead.phone || 'lead'} (${callDuration}s - ` +
                                `${Math.ceil(callDuration / 60)} minute block(s) + ${callDuration} x 0.05)`
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
