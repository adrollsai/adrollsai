import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Using service role client because this is a public webhook requested by Twilio
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const leadId = searchParams.get('leadId')
        const profileId = searchParams.get('profileId')

        let fromNumber = ''
        let toNumber = ''
        try {
            const formData = await req.formData()
            fromNumber = (formData.get('From') as string) || ''
            toNumber = (formData.get('To') as string) || ''
        } catch (e) {
            console.warn('[TWIML BRIDGE] Could not parse form data:', e)
        }

        if (!leadId || !profileId) {
            return new NextResponse('<Response><Reject /></Response>', {
                headers: { 'Content-Type': 'application/xml' }
            })
        }

        // Fetch user voice credentials
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('elevenlabs_api_key, elevenlabs_agent_id, business_name')
            .eq('id', profileId)
            .single()

        const elevenlabsApiKey = process.env.MASTER_ELEVENLABS_KEY || profile?.elevenlabs_api_key
        const elevenlabsAgentId = process.env.MASTER_ELEVENLABS_AGENT_ID || profile?.elevenlabs_agent_id

        if (!elevenlabsApiKey || !elevenlabsAgentId) {
            console.error('[TWIML BRIDGE] Missing voice configuration for profile:', profileId)
            return new NextResponse('<Response><Say>Voice configuration is missing on the server.</Say><Hangup /></Response>', {
                headers: { 'Content-Type': 'application/xml' }
            })
        }

        // Fetch lead information
        const { data: lead } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, email, source, custom_fields, voice_call_summary, voice_call_transcript')
            .eq('id', leadId)
            .single()

        if (!lead) {
            console.error('[TWIML BRIDGE] Lead not found:', leadId)
            return new NextResponse('<Response><Reject /></Response>', {
                headers: { 'Content-Type': 'application/xml' }
            })
        }

        // Retrieve past WhatsApp conversation history for full context
        let whatsappHistory = ''
        try {
            const cleanLeadPhone = lead.phone.replace(/\D/g, '')
            const { data: chat } = await supabaseAdmin
                .from('whatsapp_chats')
                .select('id')
                .eq('user_id', profileId)
                .eq('recipient_phone', cleanLeadPhone)
                .maybeSingle()

            if (chat) {
                const { data: msgs } = await supabaseAdmin
                    .from('whatsapp_messages')
                    .select('direction, message_text')
                    .eq('chat_id', chat.id)
                    .order('created_at', { ascending: false })
                    .limit(8)

                if (msgs && msgs.length > 0) {
                    whatsappHistory = msgs
                        .reverse()
                        .map(m => `${m.direction === 'inbound' ? 'Lead' : 'Agent'}: ${m.message_text}`)
                        .join('\n')
                }
            }
        } catch (historyErr) {
            console.warn('[TWIML BRIDGE] Failed to fetch chat history context:', historyErr)
        }

        // Build context from previous AI voice calls
        let previousCallContext = ''
        if (lead.voice_call_summary) {
            previousCallContext = `Summary: ${lead.voice_call_summary}`
            if (lead.voice_call_transcript && Array.isArray(lead.voice_call_transcript) && lead.voice_call_transcript.length > 0) {
                const formattedPastTranscript = lead.voice_call_transcript
                    .map((t: any) => `${t.role === 'agent' ? 'Agent' : 'Lead'}: ${t.message || t.text || ''}`)
                    .join('\n')
                previousCallContext += `\nTranscript:\n${formattedPastTranscript}`
            }
        }

        // Compose full contextual background for ElevenLabs LLM prompt injection
        const leadContextText = `
Lead Name: ${lead.name || 'Unknown'}
Source: ${lead.source || 'Direct Registration'}
Email: ${lead.email || 'None'}
Attributed Details: ${JSON.stringify(lead.custom_fields || {})}
${previousCallContext ? `\n--- PREVIOUS VOICE CALL LOG ---\n${previousCallContext}` : ''}
${whatsappHistory ? `\n--- PREVIOUS WHATSAPP CHAT LOG ---\n${whatsappHistory}` : ''}
`.trim()

        // Call ElevenLabs twilio/register-call to retrieve the TwiML configuration
        const elevenlabsUrl = 'https://api.elevenlabs.io/v1/convai/twilio/register-call'
        const elRes = await fetch(elevenlabsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': elevenlabsApiKey
            },
            body: JSON.stringify({
                agent_id: elevenlabsAgentId,
                from_number: fromNumber,
                to_number: toNumber,
                conversation_initiation_client_data: {
                    dynamic_variables: {
                        user_name: lead.name || 'there',
                        company_name: profile?.business_name || 'our company',
                        lead_context: leadContextText,
                        lead_id: leadId // Embedded so we can retrieve it in the post-call webhook
                    }
                }
            })
        })

        if (!elRes.ok) {
            const errText = await elRes.text()
            console.error('[TWIML BRIDGE] ElevenLabs connection failed:', errText)
            return new NextResponse('<Response><Say>Connection to voice assistant failed.</Say><Hangup /></Response>', {
                headers: { 'Content-Type': 'application/xml' }
            })
        }

        // ElevenLabs returns direct XML TwiML code
        const twimlXml = await elRes.text()

        return new NextResponse(twimlXml, {
            headers: { 'Content-Type': 'application/xml' }
        })
    } catch (e: any) {
        console.error('[TWIML BRIDGE] Unexpected error:', e)
        return new NextResponse('<Response><Reject /></Response>', {
            headers: { 'Content-Type': 'application/xml' }
        })
    }
}
