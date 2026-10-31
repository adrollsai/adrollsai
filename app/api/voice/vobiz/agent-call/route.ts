import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
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
                    last_called_by: `${agentName} (VoIP)`
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
