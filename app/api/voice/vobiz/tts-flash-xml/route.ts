import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveAppUrl, resolveVoiceBridgeUrl } from '@/utils/app-url'

/**
 * Answer webhook for the Gemini 3.8 Flash TTS pipeline demo
 * (/dashboard/gemini-tts-flash-demo).
 *
 * It is deliberately separate from /api/voice/vobiz/xml so the production
 * Gemini Live path cannot be affected by anything in this demo. The only
 * difference at the telephony level is which bridge WebSocket endpoint the
 * bidirectional media stream points at:
 *
 *   Live pipeline  ->  {bridge}/gemini-live-stream
 *   TTS-Flash      ->  {bridge}/tts-flash-stream
 *
 * Both speak the same carrier contract (audio/x-l16 @ 16kHz, bidirectional,
 * JSON media frames), so nothing else about the call has to change.
 */

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
)

export async function GET(req: Request) {
    return handle(req)
}

export async function POST(req: Request) {
    return handle(req)
}

async function handle(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const leadId = searchParams.get('leadId') || ''
        const profileId = searchParams.get('profileId') || ''
        const campaignId = searchParams.get('campaignId') || ''
        const voiceId = searchParams.get('voiceId') || ''
        const gender = searchParams.get('gender') || ''

        let callUuid =
            searchParams.get('CallUUID') ||
            searchParams.get('call_uuid') ||
            searchParams.get('callUuid') ||
            ''

        // Vobiz posts the call metadata as JSON/form on the answer webhook.
        try {
            const contentType = req.headers.get('content-type') || ''
            if (contentType.includes('application/json')) {
                const json = await req.json().catch(() => ({}))
                callUuid = callUuid || json.CallUUID || json.call_uuid || json.callUuid || ''
            } else if (contentType.includes('form')) {
                const form = await req.formData().catch(() => null)
                if (form) {
                    callUuid = callUuid ||
                        (form.get('CallUUID') as string) ||
                        (form.get('call_uuid') as string) ||
                        ''
                }
            }
        } catch {
            // Query params already provided everything we need.
        }

        console.log(`[TTS-FLASH XML] Answer webhook: lead=${leadId} profile=${profileId} call=${callUuid}`)

        if (!leadId || !profileId) {
            console.error('[TTS-FLASH XML] Missing leadId/profileId — hanging up')
            return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>')
        }

        let authId = searchParams.get('vobizAuthId') || process.env.VOBIZ_AUTH_ID || ''
        let authToken = searchParams.get('vobizAuthToken') || process.env.VOBIZ_AUTH_TOKEN || ''

        if (!searchParams.get('vobizAuthId')) {
            try {
                const { data: prof } = await supabaseAdmin
                    .from('profiles')
                    .select('business_info')
                    .eq('id', profileId)
                    .maybeSingle()
                const bi = typeof prof?.business_info === 'string'
                    ? JSON.parse(prof.business_info)
                    : (prof?.business_info || {})
                authId = bi?.voice_vobiz_auth_id || bi?.kyc_data?.vobizSubAuthId || authId
                authToken = bi?.voice_vobiz_auth_token || authToken
            } catch { /* fall back to env credentials */ }
        }

        const appUrl = resolveAppUrl()
        const bridgeHost = resolveVoiceBridgeUrl()

        // Best-effort carrier-side recording, exactly like the Live pipeline.
        if (callUuid && authId && authToken) {
            const recordCallbackUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${leadId}&event=recording`
            fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/Record/`, {
                method: 'POST',
                headers: {
                    'X-Auth-ID': authId,
                    'X-Auth-Token': authToken,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    file_format: 'mp3',
                    time_limit: 1800,
                    callback_url: recordCallbackUrl,
                    callback_method: 'POST',
                }),
            }).catch(e => console.warn('[TTS-FLASH XML] Recording trigger warning:', e.message))
        }

        const streamParams = new URLSearchParams({
            leadId,
            profileId,
            telephony: 'vobiz',
        })
        if (callUuid) streamParams.set('callUuid', callUuid)
        if (campaignId) streamParams.set('campaignId', campaignId)
        if (voiceId) streamParams.set('voiceId', voiceId)
        if (gender) streamParams.set('gender', gender)

        const wsUrl = `${bridgeHost}/tts-flash-stream?${streamParams.toString()}`
        const escaped = wsUrl.replace(/&/g, '&amp;')

        const payload = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" keepCallAlive="true" streamTimeout="3600" contentType="audio/x-l16;rate=16000">${escaped}</Stream>
</Response>`

        console.log(`[TTS-FLASH XML] Returning stream XML ->\n${payload}`)
        return xml(payload)
    } catch (err: any) {
        console.error('[TTS-FLASH XML] Unexpected error:', err)
        return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>')
    }
}

function xml(body: string) {
    return new NextResponse(body, {
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' },
    })
}
