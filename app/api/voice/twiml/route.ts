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

        // Fetch user voice credentials including business_info
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', profileId)
            .single()

        const voiceProvider = profile?.voice_provider || 'elevenlabs'

        if (voiceProvider === 'elevenlabs') {
            const elevenlabsApiKey = process.env.MASTER_ELEVENLABS_KEY || profile?.elevenlabs_api_key
            const elevenlabsAgentId = process.env.MASTER_ELEVENLABS_AGENT_ID || profile?.elevenlabs_agent_id

            if (!elevenlabsApiKey || !elevenlabsAgentId) {
                console.error('[TWIML BRIDGE] Missing voice configuration for profile:', profileId)
                return new NextResponse('<Response><Say>Voice configuration is missing on the server.</Say><Hangup /></Response>', {
                    headers: { 'Content-Type': 'application/xml' }
                })
            }
        }

        // Fetch lead information including property_id and notes
        const { data: lead } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, email, source, custom_fields, voice_call_summary, voice_call_transcript, property_id, notes')
            .eq('id', leadId)
            .single()

        if (!lead) {
            console.error('[TWIML BRIDGE] Lead not found:', leadId)
            return new NextResponse('<Response><Reject /></Response>', {
                headers: { 'Content-Type': 'application/xml' }
            })
        }

        // Fetch product/property details if the lead is attributed to one
        let productContext = ''
        if (lead.property_id) {
            try {
                const { data: prop } = await supabaseAdmin
                    .from('properties')
                    .select('title, description, price, address, property_type, configurations')
                    .eq('id', lead.property_id)
                    .single()
                
                if (prop) {
                    productContext = `Primary Interest Product/Property Name: ${prop.title || 'N/A'}
Description: ${prop.description || 'N/A'}
Price: ${prop.price || 'N/A'}
Location: ${prop.address || 'N/A'}
Type: ${prop.property_type || 'N/A'}
Configurations: ${JSON.stringify(prop.configurations || {})}`
                }
            } catch (propErr) {
                console.warn('[TWIML BRIDGE] Failed to fetch product/property context:', propErr)
            }
        }

        // Fetch the full catalog of other products/properties owned by the user (up to 10 items)
        let catalogContext = ''
        try {
            const { data: props } = await supabaseAdmin
                .from('properties')
                .select('title, description, price, address, property_type')
                .eq('user_id', profileId)
                .limit(10)

            if (props && props.length > 0) {
                catalogContext = props
                    .map((p, idx) => `${idx + 1}. ${p.title || 'N/A'}${p.property_type ? ` (${p.property_type})` : ''}
   Price: ${p.price || 'N/A'}
   Description: ${p.description || 'N/A'}${p.address ? `\n   Location: ${p.address}` : ''}`)
                    .join('\n\n')
            }
        } catch (catErr) {
            console.warn('[TWIML BRIDGE] Failed to fetch catalog context:', catErr)
        }

        // Retrieve past WhatsApp conversation history (increased to 15 messages)
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
                    .limit(15)

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

        // Build context from multiple previous AI voice call summaries via lead_history
        let previousCallsHistory = ''
        try {
            const { data: historyLogs } = await supabaseAdmin
                .from('lead_history')
                .select('description, created_at')
                .eq('lead_id', leadId)
                .eq('action_type', 'REMARK')
                .order('created_at', { ascending: false })
                .limit(5)

            if (historyLogs && historyLogs.length > 0) {
                const parsedCalls: string[] = []
                for (const log of historyLogs) {
                    if (log.description && log.description.startsWith('🎙️ CALL_JSON:')) {
                        try {
                            const rawJson = log.description.replace('🎙️ CALL_JSON:', '').trim()
                            const parsed = JSON.parse(rawJson)
                            const dateStr = new Date(log.created_at).toLocaleDateString()
                            if (parsed.summary) {
                                parsedCalls.push(`- Call on ${dateStr}: ${parsed.summary}`)
                            }
                        } catch (e) {
                            // Ignore malformed json, fallback below
                        }
                    }
                }
                if (parsedCalls.length > 0) {
                    previousCallsHistory = parsedCalls.join('\n')
                }
            }
        } catch (historyErr) {
            console.warn('[TWIML BRIDGE] Failed to fetch call history logs context:', historyErr)
        }

        // Fallback to lead table columns if history logs are empty
        if (!previousCallsHistory && lead.voice_call_summary) {
            previousCallsHistory = `- Last Call Summary: ${lead.voice_call_summary}`
            if (lead.voice_call_transcript && Array.isArray(lead.voice_call_transcript) && lead.voice_call_transcript.length > 0) {
                const formattedPastTranscript = lead.voice_call_transcript
                    .map((t: any) => `${t.role === 'agent' ? 'Agent' : 'Lead'}: ${t.message || t.text || ''}`)
                    .join('\n')
                previousCallsHistory += `\nLast Transcript:\n${formattedPastTranscript}`
            }
        }

        // Compose full contextual background for ElevenLabs LLM prompt injection
        const leadContextText = `
Lead Name: ${lead.name || 'Unknown'}
Source: ${lead.source || 'Direct Registration'}
Email: ${lead.email || 'None'}
Attributed Details: ${JSON.stringify(lead.custom_fields || {})}
Current Time: ${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}

--- BUSINESS PROFILE INFO ---
Company/Business Name: ${profile?.business_name || 'N/A'}
About the Business / FAQ / Mission: ${profile?.business_info || 'N/A'}

--- LEAD CRM NOTES / SCHEDULE HISTORY ---
${lead.notes || 'None'}

${productContext ? `--- LEAD'S PRIMARY INTEREST ---\n${productContext}\n` : ''}
${catalogContext ? `--- FULL CATALOG / ALL AVAILABLE PRODUCTS ---\n${catalogContext}\n` : ''}
${previousCallsHistory ? `--- PREVIOUS VOICE CALL HISTORY ---\n${previousCallsHistory}\n` : ''}
${whatsappHistory ? `--- PREVIOUS WHATSAPP CHAT HISTORY ---\n${whatsappHistory}` : ''}
`.trim()

        const companyName = profile?.business_name || 'our company'
        const leadName = lead.name || 'there'
        const customPrompt = `
You are a professional, helpful outbound AI calling assistant calling on behalf of ${companyName}.
Your name is a booking representative.
Your primary objective is to make the lead, ${leadName}, book an appointment/consultation with the business.

CRITICAL RULES:
1. ONLY speak about the provided business profile info, catalog, and the lead's own previous conversation history/CRM notes.
2. DO NOT make up, assume, or hallucinate any details. Under no circumstances mention unrelated businesses (such as cafes, unrelated locations like "Sarah's Cafe in Mohali", etc.). If asked a question about the business profile or catalog that you don't have details for, say: "That is a great question. I don't have that detail on hand, but let's book a quick consultation call so our representative can answer that for you."
3. Be polite, friendly, and brief in your responses. Keep all answers extremely short (under 50 words) and direct. Never speak long paragraphs, as shorter responses improve audio streaming speed and prevent robotic stutter.
4. Your single goal is to find a suitable date and time slot for a meeting.
5. LANGUAGE STYLE: Speak in a natural, friendly mix of Hindi and English (Hinglish) when responding to the user, as this is the preferred style of communication in India. If the lead speaks in pure English, you may respond in English, but default to Hinglish or match the lead's preferred language.
6. PAST CALLS AND SCHEDULES: If the lead asks about when they requested a callback, how much time they asked to be called back in, or what you talked about in the last call, read the '--- LEAD CRM NOTES & SCHEDULE HISTORY ---' and 'Previous Call History' sections to answer them accurately in Hinglish (e.g. 'Aapne mujhe 1 minute baad call karne ko bola tha').
7. ENDING THE CALL: Once the call objective is met (e.g. appointment is booked, callback is scheduled) or the lead wants to end the conversation, say a brief polite goodbye and immediately trigger your "End conversation" tool to hang up the call. Do not wait for the user to respond after your goodbye.

--- LEAD & BUSINESS CONTEXT ---
Lead Name: ${leadName}
Email: ${lead.email || 'None'}
Attributed Details: ${JSON.stringify(lead.custom_fields || {})}
Current Time: ${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}

Business Profile:
${profile?.business_info || 'N/A'}

--- LEAD CRM NOTES & SCHEDULE HISTORY ---
${lead.notes || 'None'}

${productContext ? `Interested Product:\n${productContext}\n` : ''}
${catalogContext ? `Catalog / Available Products:\n${catalogContext}\n` : ''}
${previousCallsHistory ? `Previous Call History:\n${previousCallsHistory}\n` : ''}
${whatsappHistory ? `Previous WhatsApp History:\n${whatsappHistory}` : ''}
`.trim()

        const dynamicFirstMessage = `Hi ${leadName}! Main ${companyName} se AI booking assistant baat kar raha hoon. Maine dekha aap hamare products me interest le rahe the, to kya hum ek quick consultation call schedule kar sakte hain? Aap kaise hain?`

        if (voiceProvider === 'gemini') {
            const bridgeHost = process.env.GEMINI_VOICE_BRIDGE_URL || 'ws://localhost:5050'
            const streamUrl = `${bridgeHost}/gemini-live-stream`
            console.log(`[TWIML BRIDGE] Redirecting Twilio Media Stream to Gemini Live Bridge: ${streamUrl}`)
            
            const geminiTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="en-IN" voice="Polly.Aditi">Connecting.</Say>
    <Connect>
        <Stream url="${streamUrl}">
            <Parameter name="leadId" value="${leadId}" />
            <Parameter name="profileId" value="${profileId}" />
        </Stream>
    </Connect>
</Response>`
            return new NextResponse(geminiTwiml, {
                headers: { 'Content-Type': 'application/xml' }
            })
        }

        const elevenlabsApiKey = process.env.MASTER_ELEVENLABS_KEY || profile?.elevenlabs_api_key
        const elevenlabsAgentId = process.env.MASTER_ELEVENLABS_AGENT_ID || profile?.elevenlabs_agent_id

        // Call ElevenLabs twilio/register-call to retrieve the TwiML configuration
        const elevenlabsUrl = 'https://api.elevenlabs.io/v1/convai/twilio/register-call'
        const elRes = await fetch(elevenlabsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': elevenlabsApiKey || ''
            },
            body: JSON.stringify({
                agent_id: elevenlabsAgentId,
                from_number: fromNumber,
                to_number: toNumber,
                conversation_initiation_client_data: {
                    conversation_config_override: {
                        agent: {
                            prompt: {
                                prompt: customPrompt
                            },
                            first_message: dynamicFirstMessage
                        },
                        tts: {
                            model_id: "eleven_flash_v2_5", // Optimize for real-time low-latency calls
                            stability: 0.65, // Improves natural intonation
                            similarity_boost: 0.8
                        }
                    },
                    dynamic_variables: {
                        user_name: leadName,
                        company_name: companyName,
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
        let twimlXml = await elRes.text()

        // Ensure that Twilio hangs up the call as soon as ElevenLabs closes the media stream
        if (twimlXml.includes('</Response>')) {
            twimlXml = twimlXml.replace('</Response>', '  <Hangup />\n</Response>')
        }

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
