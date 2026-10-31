import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { formatCallPhone } from '@/utils/dialer'

const BLUESQUARE_DID = '+917965480905'
const BLUESQUARE_VOBIZ_AUTH_ID = 'SA_RUY0ZNCH'
const BLUESQUARE_VOBIZ_AUTH_TOKEN = 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi'

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { action = 'dial', toPhone, leadId, sessionId, callUuid } = body

        // Fetch caller profile and parent profile (if agent or team member)
        const { data: callerProfile } = await supabase
            .from('profiles')
            .select('id, role, parent_id, agency_id, full_name, email, business_name, business_info, voice_vobiz_number, voice_vobiz_auth_id, voice_vobiz_auth_token')
            .eq('id', user.id)
            .single()

        let parentProfile: any = null
        if (callerProfile?.parent_id) {
            const { data: pData } = await supabase
                .from('profiles')
                .select('id, role, full_name, email, business_name, business_info, voice_vobiz_number, voice_vobiz_auth_id, voice_vobiz_auth_token')
                .eq('id', callerProfile.parent_id)
                .single()
            parentProfile = pData
        }

        const bi = typeof callerProfile?.business_info === 'string' ? JSON.parse(callerProfile.business_info) : (callerProfile?.business_info || {})
        const parentBi = typeof parentProfile?.business_info === 'string' ? JSON.parse(parentProfile.business_info) : (parentProfile?.business_info || {})

        const effectiveAuthId = callerProfile?.voice_vobiz_auth_id 
            || bi?.voice_vobiz_auth_id 
            || bi?.kyc_data?.vobizSubAuthId 
            || parentProfile?.voice_vobiz_auth_id 
            || parentBi?.voice_vobiz_auth_id 
            || parentBi?.kyc_data?.vobizSubAuthId 
            || process.env.VOBIZ_AUTH_ID 
            || BLUESQUARE_VOBIZ_AUTH_ID

        const effectiveAuthToken = callerProfile?.voice_vobiz_auth_token 
            || bi?.voice_vobiz_auth_token 
            || parentProfile?.voice_vobiz_auth_token 
            || parentBi?.voice_vobiz_auth_token 
            || process.env.VOBIZ_AUTH_TOKEN 
            || BLUESQUARE_VOBIZ_AUTH_TOKEN

        const effectiveCallerId = callerProfile?.voice_vobiz_number 
            || bi?.claimed_vobiz_number 
            || bi?.voice_vobiz_number 
            || parentProfile?.voice_vobiz_number 
            || parentBi?.claimed_vobiz_number 
            || parentBi?.voice_vobiz_number 
            || BLUESQUARE_DID

        if (action === 'hangup') {
            if (callUuid) {
                try {
                    await fetch(`https://api.vobiz.ai/api/v1/Account/${effectiveAuthId}/Call/${callUuid}/`, {
                        method: 'DELETE',
                        headers: {
                            'X-Auth-ID': effectiveAuthId,
                            'X-Auth-Token': effectiveAuthToken
                        }
                    })
                } catch (e) {}
            }
            return NextResponse.json({ success: true, message: 'Call hangup signal dispatched' })
        }

        if (action === 'finalize') {
            if (!callUuid) {
                return NextResponse.json({ error: 'callUuid is required to finalize call' }, { status: 400 })
            }

            console.log(`[AGENT CALL API] Finalizing call ${callUuid} for lead ${leadId} (auth: ${effectiveAuthId})...`)
            const adminSupabase = createSupabaseAdmin(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            )

            // Fetch recording from Vobiz Recording API with retries
            let recordingUrl: string | null = null
            for (let attempt = 1; attempt <= 4; attempt++) {
                try {
                    await new Promise(r => setTimeout(r, attempt === 1 ? 2500 : 4000))
                    const recRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${effectiveAuthId}/Recording/?call_uuid=${callUuid}&limit=5`, {
                        headers: {
                            'X-Auth-ID': effectiveAuthId,
                            'X-Auth-Token': effectiveAuthToken
                        }
                    })
                    if (recRes.ok) {
                        const recData = await recRes.json().catch(() => ({}))
                        const objects = recData.objects || (recData.recording_url ? [recData] : [])
                        for (const r of objects) {
                            const mp3 = r.recording_url || r.url || r.mp3_url
                            if (mp3) {
                                const audioFetch = await fetch(mp3, {
                                    headers: { 'X-Auth-ID': effectiveAuthId, 'X-Auth-Token': effectiveAuthToken }
                                })
                                if (audioFetch.ok) {
                                    const audioBuffer = Buffer.from(await audioFetch.arrayBuffer())
                                    if (audioBuffer.byteLength > 1000) {
                                        const storagePath = `${leadId || 'manual'}/vobiz_voip_${callUuid}.mp3`
                                        const { error: upErr } = await adminSupabase.storage
                                            .from('lead-voice-recordings')
                                            .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true })
                                        if (!upErr) {
                                            const { data: pubData } = adminSupabase.storage
                                                .from('lead-voice-recordings')
                                                .getPublicUrl(storagePath)
                                            recordingUrl = pubData?.publicUrl || mp3
                                        } else {
                                            recordingUrl = mp3
                                        }
                                        break
                                    }
                                }
                            }
                        }
                        if (recordingUrl) break
                    }
                } catch (err: any) {
                    console.warn(`[AGENT CALL API] Recording fetch attempt ${attempt} warning:`, err.message)
                }
            }

            // Gemini AI Analysis
            let summary = 'Agent connected with lead via in-app VoIP softphone.'
            let transcript: Array<{ role: string; message: string }> = []
            let sentiment = 'Neutral'
            let isQualified = false
            let isInterested = false

            if (recordingUrl) {
                try {
                    const audioRes = await fetch(recordingUrl)
                    if (audioRes.ok) {
                        const audioBuf = Buffer.from(await audioRes.arrayBuffer())
                        const audioBase64 = audioBuf.toString('base64')
                        const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ''
                        if (geminiKey) {
                            const prompt = `You are an expert sales call QA and intelligence analyst for real estate.
Analyze this recorded phone call between a human sales agent and a prospective client/lead.
Output JSON ONLY with the following schema:
{
  "summary": "Concise 2-3 sentence executive summary of what was discussed and the call outcome",
  "transcript": [
    { "role": "Agent", "message": "..." },
    { "role": "Client", "message": "..." }
  ],
  "sentiment": "Positive / Neutral / Negative / Not Interested / Dropped",
  "is_interested": true,
  "is_qualified": true
}`
                            const gemRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    contents: [{
                                        parts: [
                                            { text: prompt },
                                            { inlineData: { mimeType: 'audio/mp3', data: audioBase64 } }
                                        ]
                                    }],
                                    generationConfig: { responseMimeType: 'application/json' }
                                })
                            })
                            if (gemRes.ok) {
                                const gData = await gemRes.json()
                                const text = gData.candidates?.[0]?.content?.parts?.[0]?.text
                                if (text) {
                                    const parsed = JSON.parse(text)
                                    summary = parsed.summary || summary
                                    transcript = parsed.transcript || []
                                    sentiment = parsed.sentiment || sentiment
                                    isInterested = !!parsed.is_interested
                                    isQualified = !!parsed.is_qualified
                                }
                            }
                        }
                    }
                } catch (gErr: any) {
                    console.warn('[AGENT CALL API] Gemini analysis error:', gErr.message)
                }
            }

            // Save to DB and lead history
            if (leadId) {
                const historyData = {
                    summary,
                    recording_url: recordingUrl,
                    transcript,
                    call_type: 'Agent VoIP Call',
                    caller_did: effectiveCallerId,
                    sentiment,
                    is_interested: isInterested,
                    is_qualified: isQualified
                }

                await adminSupabase.from('lead_history').insert({
                    lead_id: leadId,
                    action_type: 'REMARK',
                    description: `🎙️ CALL_JSON:${JSON.stringify(historyData)}`
                }).catch(e => console.warn('[AGENT CALL API] History insert warning:', e.message))

                const leadUpdate: any = {
                    voice_call_status: 'completed',
                    voice_call_summary: summary,
                    voice_call_transcript: transcript,
                    last_called_by: user.id,
                    last_call_at: new Date().toISOString(),
                    last_call_status: 'completed'
                }
                if (recordingUrl) {
                    leadUpdate.voice_recording_url = recordingUrl
                }

                await adminSupabase.from('leads').update(leadUpdate).eq('id', leadId).catch(e => console.warn('[AGENT CALL API] Lead update warning:', e.message))
            }

            return NextResponse.json({
                success: true,
                summary,
                transcript,
                recordingUrl
            })
        }

        // Action === 'dial'
        if (!toPhone) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
        }

        const cleanTo = formatCallPhone(toPhone)
        if (!cleanTo || cleanTo.length < 10) {
            return NextResponse.json({ error: 'Invalid destination phone number' }, { status: 400 })
        }

        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.nobogent.com').replace(/\/$/, '')
        const bridgeHttpHost = (process.env.GEMINI_VOICE_BRIDGE_URL || process.env.NEXT_PUBLIC_VOICE_BRIDGE_URL || 'https://gemini-voice-bridge-805895515412.us-central1.run.app')
            .replace(/^wss:\/\//, 'https://')
            .replace(/^ws:\/\//, 'http://')
            .replace(/\/$/, '');
        const effectiveSessionId = sessionId || `agent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

        const answerUrl = `${bridgeHttpHost}/vobiz-xml?isAgentCall=true&sessionId=${encodeURIComponent(effectiveSessionId)}&leadId=${encodeURIComponent(leadId || '')}&profileId=${encodeURIComponent(user.id)}&vobizAuthId=${encodeURIComponent(effectiveAuthId)}&vobizAuthToken=${encodeURIComponent(effectiveAuthToken)}`
        const hangupUrl = `${bridgeHttpHost}/vobiz-status?isAgentCall=true&sessionId=${encodeURIComponent(effectiveSessionId)}&leadId=${encodeURIComponent(leadId || '')}&vobizAuthId=${encodeURIComponent(effectiveAuthId)}&vobizAuthToken=${encodeURIComponent(effectiveAuthToken)}`

        const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${effectiveAuthId}/Call/`
        const payload = {
            from: effectiveCallerId,
            to: cleanTo,
            answer_url: answerUrl,
            hangup_url: hangupUrl
        }

        console.log(`[AGENT CALL API] Initiating Vobiz call: ${effectiveCallerId} -> ${cleanTo} (Session: ${effectiveSessionId}, Auth: ${effectiveAuthId})`)

        const vobizRes = await fetch(vobizUrl, {
            method: 'POST',
            headers: {
                'X-Auth-ID': effectiveAuthId,
                'X-Auth-Token': effectiveAuthToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })

        const vobizData = await vobizRes.json().catch(() => ({}))

        if (!vobizRes.ok) {
            console.error('[AGENT CALL API] Vobiz error response:', vobizRes.status, vobizData)
            return NextResponse.json({
                error: vobizData?.message || vobizData?.error || `Vobiz call initiation failed (${vobizRes.status})`
            }, { status: 400 })
        }

        const activeCallUuid = vobizData.call_uuid || vobizData.request_uuid || null

        // Trigger immediate background recording via Vobiz REST API if activeCallUuid is already returned
        if (activeCallUuid) {
            const recordCallbackUrl = `${bridgeHttpHost}/vobiz-status?isAgentCall=true&sessionId=${encodeURIComponent(effectiveSessionId)}&leadId=${encodeURIComponent(leadId || '')}&event=recording`
            fetch(`https://api.vobiz.ai/api/v1/Account/${effectiveAuthId}/Call/${activeCallUuid}/Record/`, {
                method: 'POST',
                headers: {
                    'X-Auth-ID': effectiveAuthId,
                    'X-Auth-Token': effectiveAuthToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file_format: 'mp3',
                    time_limit: 1800,
                    callback_url: recordCallbackUrl,
                    callback_method: 'POST'
                })
            }).catch(e => console.warn(`[AGENT CALL API] Pre-emptive record trigger warning:`, e.message))
        }

        // If a leadId was passed, update voice_call_status and insert lead_history
        if (leadId) {
            const agentName = callerProfile?.full_name || callerProfile?.business_name || user.email?.split('@')[0] || 'Agent'
            try {
                await supabase.from('leads').update({
                    voice_call_status: 'calling',
                    last_called_by: user.id,
                    last_call_at: new Date().toISOString(),
                    last_call_status: 'calling'
                }).eq('id', leadId)
            } catch (e) {}

            try {
                await supabase.from('lead_history').insert({
                    lead_id: leadId,
                    action_type: 'REMARK',
                    description: `🎙️ In-app VoIP call initiated by ${agentName} via ${effectiveCallerId}`
                })
            } catch (e) {}
        }

        return NextResponse.json({
            success: true,
            sessionId: effectiveSessionId,
            callUuid: activeCallUuid,
            callerDid: effectiveCallerId,
            destination: cleanTo
        })

    } catch (err: any) {
        console.error('[AGENT CALL API] Unexpected error:', err)
        return NextResponse.json({ error: err.message || 'Failed to initiate agent VoIP call' }, { status: 500 })
    }
}
