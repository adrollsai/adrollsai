import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // Fetch credentials
        const { data: profile, error: profErr } = await supabase
            .from('profiles')
            .select('elevenlabs_api_key, elevenlabs_agent_id, voice_twilio_sid, voice_twilio_token, voice_twilio_number')
            .eq('id', user.id)
            .single()

        if (profErr || !profile) {
            return NextResponse.json({ error: 'Failed to fetch user profile.' }, { status: 500 })
        }

        const twilioSid = process.env.MASTER_TWILIO_SID || profile.voice_twilio_sid || process.env.DEV_TWILIO_SID
        const twilioToken = process.env.MASTER_TWILIO_TOKEN || profile.voice_twilio_token || process.env.DEV_TWILIO_TOKEN
        const voiceNumber = profile.voice_twilio_number || process.env.MASTER_TWILIO_NUMBER

        if (!twilioSid || !twilioToken || !voiceNumber) {
            return NextResponse.json({ 
                error: 'Voice calling credentials or phone number are not configured. Please contact support or set up your phone settings.' 
            }, { status: 400 })
        }

        const body = await req.json()
        const { leadId, leadIds } = body

        const targets: string[] = []
        if (leadId) targets.push(leadId)
        if (Array.isArray(leadIds)) targets.push(...leadIds)

        if (targets.length === 0) {
            return NextResponse.json({ error: 'No lead targets provided.' }, { status: 400 })
        }

        const results = []
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

        for (const targetId of targets) {
            try {
                // Fetch lead details
                const { data: lead, error: leadErr } = await supabase
                    .from('leads')
                    .select('id, name, phone')
                    .eq('id', targetId)
                    .single()

                if (leadErr || !lead || !lead.phone) {
                    results.push({ leadId: targetId, success: false, error: 'Lead not found or has no phone number.' })
                    continue
                }

                // Format phone number to E.164 (Twilio requirement)
                let cleanPhone = lead.phone.replace(/\D/g, '')
                if (!cleanPhone.startsWith('+')) {
                    if (cleanPhone.length === 10) {
                        cleanPhone = '+91' + cleanPhone // Default to India country code if 10 digits
                    } else if (!cleanPhone.startsWith('91') && cleanPhone.length > 10) {
                        cleanPhone = '+' + cleanPhone
                    } else {
                        cleanPhone = '+' + cleanPhone
                    }
                }

                // Update lead call status to calling
                await supabase
                    .from('leads')
                    .update({ voice_call_status: 'calling' })
                    .eq('id', lead.id)

                // Call Twilio REST API using native fetch
                const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`
                const twilioAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')

                const params = new URLSearchParams()
                // Direct Twilio to request the TWIML bridge configuration when call starts
                params.append('Url', `${appUrl}/api/voice/twiml?leadId=${lead.id}&profileId=${user.id}`)
                params.append('To', cleanPhone)
                params.append('From', voiceNumber.trim())
                // Notify when the call hangs up or fails to prevent status getting stuck
                params.append('StatusCallback', `${appUrl}/api/voice/status-callback?leadId=${lead.id}`)

                const twilioRes = await fetch(twilioUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${twilioAuth}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params
                })

                const twilioData = await twilioRes.json()

                if (!twilioRes.ok) {
                    console.error('[OUTBOUND CALL] Twilio Error:', twilioData)
                    await supabase
                        .from('leads')
                        .update({ voice_call_status: 'failed' })
                        .eq('id', lead.id)

                    results.push({ leadId: targetId, success: false, error: twilioData.message || 'Twilio calling failed.' })
                } else {
                    results.push({ leadId: targetId, success: true, callSid: twilioData.sid })
                }
            } catch (err: any) {
                results.push({ leadId: targetId, success: false, error: err.message })
            }
        }

        return NextResponse.json({ success: true, results })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
