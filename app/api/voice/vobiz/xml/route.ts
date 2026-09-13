import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { warmupVoiceBridge } from '@/utils/voice-helper'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    return handleRequest(req)
}

export async function POST(req: Request) {
    return handleRequest(req)
}

async function handleRequest(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        let leadId = searchParams.get('leadId')
        let profileId = searchParams.get('profileId')
        const campaignId = searchParams.get('campaignId')

        let fromNumber = ''
        let toNumber = ''
        let callUuid = ''

        try {
            const contentType = req.headers.get('content-type') || ''
            if (contentType.includes('application/json')) {
                const json = await req.json().catch(() => ({}))
                fromNumber = json.From || json.from || ''
                toNumber = json.To || json.to || ''
                callUuid = json.CallUUID || json.call_uuid || json.callUuid || ''
            } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
                const formData = await req.formData().catch(() => null)
                if (formData) {
                    fromNumber = (formData.get('From') as string) || (formData.get('from') as string) || ''
                    toNumber = (formData.get('To') as string) || (formData.get('to') as string) || ''
                    callUuid = (formData.get('CallUUID') as string) || (formData.get('call_uuid') as string) || (formData.get('callUuid') as string) || ''
                }
            } else {
                const rawText = await req.text().catch(() => '')
                try {
                    const json = JSON.parse(rawText)
                    fromNumber = json.From || json.from || ''
                    toNumber = json.To || json.to || ''
                    callUuid = json.CallUUID || json.call_uuid || json.callUuid || ''
                } catch {
                    const params = new URLSearchParams(rawText)
                    fromNumber = params.get('From') || params.get('from') || ''
                    toNumber = params.get('To') || params.get('to') || ''
                    callUuid = params.get('CallUUID') || params.get('call_uuid') || params.get('callUuid') || ''
                }
            }
        } catch {
            // URL searchParams fallback
        }

        if (!callUuid) callUuid = searchParams.get('CallUUID') || searchParams.get('call_uuid') || searchParams.get('callUuid') || ''
        if (!fromNumber) fromNumber = searchParams.get('From') || searchParams.get('from') || ''
        if (!toNumber) toNumber = searchParams.get('To') || searchParams.get('to') || ''

        console.log(`[VOBIZ XML] Answer callback received. leadId: ${leadId}, profileId: ${profileId}, campaignId: ${campaignId}, CallUUID: ${callUuid}`)

        let isInbound = false
        // If inbound call without leadId, resolve by phone
        if (!profileId && toNumber) {
            isInbound = true
            const cleanTo = toNumber.replace(/\D/g, '')
            const { data: matchProfile } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .or(`voice_twilio_number.eq.${toNumber},voice_twilio_number.eq.+${cleanTo},voice_twilio_number.eq.${cleanTo},voice_twilio_number.ilike.%${cleanTo.slice(-10)}%`)
                .limit(1)
                .maybeSingle()

            if (matchProfile) {
                profileId = matchProfile.id
            } else {
                const { data: defaultUser } = await supabaseAdmin
                    .from('profiles')
                    .select('id')
                    .or('email.eq.rchopra489@gmail.com,email.eq.infobluesquareinfra@gmail.com')
                    .limit(1)
                    .maybeSingle()
                if (defaultUser) profileId = defaultUser.id
            }
        }

        if (profileId && !leadId && fromNumber) {
            isInbound = true
            const cleanFrom = fromNumber.replace(/\D/g, '')
            const { data: matchLead } = await supabaseAdmin
                .from('leads')
                .select('id')
                .eq('user_id', profileId)
                .or(`phone.eq.${fromNumber},phone.eq.+${cleanFrom},phone.eq.${cleanFrom},phone.ilike.%${cleanFrom.slice(-10)}%`)
                .limit(1)
                .maybeSingle()

            if (matchLead) {
                leadId = matchLead.id
            } else {
                const { data: newLead } = await supabaseAdmin
                    .from('leads')
                    .insert({
                        user_id: profileId,
                        name: `Inbound Caller (${fromNumber})`,
                        phone: fromNumber,
                        source: 'Inbound Call (Vobiz)',
                        pipeline_stage: 'New'
                    })
                    .select('id')
                    .single()

                if (newLead) leadId = newLead.id
            }
        }

        if (!leadId || !profileId) {
            console.error(`[VOBIZ XML] Missing routing parameters: leadId=${leadId}, profileId=${profileId}`)
            return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>', {
                headers: { 'Content-Type': 'application/xml' }
            })
        }

        // Fetch lead and campaign context
        const { data: lead } = await supabaseAdmin
            .from('leads')
            .select('id, user_id, voice_campaign_id, source')
            .eq('id', leadId)
            .single()

        if ((lead?.source || '').toLowerCase().includes('inbound')) {
            isInbound = true
        }

        const effectiveProfileId = lead?.user_id || profileId
        const effectiveCampaignId = campaignId || lead?.voice_campaign_id

        // Prewarm voice bridge session
        warmupVoiceBridge(leadId, effectiveProfileId, effectiveCampaignId || undefined)
            .catch(e => console.warn('[VOBIZ XML] Prewarm error:', e))

        let appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
        if (appUrl.includes('localhost') || appUrl.includes('local.nobogent.com') || appUrl.includes('127.0.0.1')) {
            appUrl = 'https://app.nobogent.com'
        }

        const bridgeHost = process.env.GEMINI_VOICE_BRIDGE_URL || 'wss://gemini-voice-bridge-805895515412.us-central1.run.app'
        const statusCallbackUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${leadId}`
        const wsStreamUrl = `${bridgeHost}/gemini-live-stream?leadId=${leadId}&profileId=${effectiveProfileId}${effectiveCampaignId ? `&campaignId=${effectiveCampaignId}` : ''}&telephony=vobiz${isInbound ? '&inbound=true' : ''}${callUuid ? `&callUuid=${callUuid}` : ''}`

        // Trigger non-blocking call recording on active call via Vobiz REST API
        if (callUuid) {
            const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
            const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'
            const recordCallbackUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${leadId}&event=recording`

            console.log(`[VOBIZ XML] Triggering background REST recording for active call ${callUuid} (lead ${leadId})...`)
            fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/Record/`, {
                method: 'POST',
                headers: {
                    'X-Auth-ID': authId,
                    'X-Auth-Token': authToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file_format: 'mp3',
                    time_limit: 1800,
                    callback_url: recordCallbackUrl,
                    callback_method: 'POST'
                })
            }).then(async r => {
                const d = await r.json().catch(() => ({}))
                console.log(`[VOBIZ XML] Vobiz REST Record API response for ${callUuid}: status=${r.status}`, d)
            }).catch(e => console.warn(`[VOBIZ XML] Vobiz REST Record trigger warning for ${callUuid}:`, e.message))
        }

        const escapedWsUrl = wsStreamUrl.replace(/&/g, '&amp;')

        // Generate valid Vobiz XML with bidirectional Linear PCM 16kHz stream
        const vobizXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=16000" statusCallbackUrl="${statusCallbackUrl}">${escapedWsUrl}</Stream>
</Response>`

        console.log(`[VOBIZ XML] Returning Vobiz Stream XML for lead ${leadId}:`, vobizXml)

        return new NextResponse(vobizXml, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8'
            }
        })
    } catch (err: any) {
        console.error('[VOBIZ XML] Unexpected error:', err)
        return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>', {
            headers: { 'Content-Type': 'application/xml' }
        })
    }
}
