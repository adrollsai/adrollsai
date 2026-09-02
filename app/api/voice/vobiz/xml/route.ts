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
            const formData = await req.formData()
            fromNumber = (formData.get('From') as string) || (formData.get('from') as string) || ''
            toNumber = (formData.get('To') as string) || (formData.get('to') as string) || ''
            callUuid = (formData.get('CallUUID') as string) || (formData.get('call_uuid') as string) || ''
        } catch {
            // URL searchParams fallback
        }

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
        const wsStreamUrl = `${bridgeHost}/gemini-live-stream?leadId=${leadId}&amp;profileId=${effectiveProfileId}${effectiveCampaignId ? `&amp;campaignId=${effectiveCampaignId}` : ''}&amp;telephony=vobiz${isInbound ? '&amp;inbound=true' : ''}`

        // Generate Vobiz XML with audio recording and bidirectional Linear PCM 16kHz stream
        const vobizXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Record action="${statusCallbackUrl}" method="POST" recordSession="true" redirect="false" maxLength="3600" playBeep="false"/>
    <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=16000" statusCallbackUrl="${statusCallbackUrl}">${wsStreamUrl}</Stream>
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
