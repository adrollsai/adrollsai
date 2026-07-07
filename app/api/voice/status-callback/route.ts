import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callGemini } from '@/utils/external-apis'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function POST(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const leadId = searchParams.get('leadId')

        if (!leadId) {
            return NextResponse.json({ success: false, error: 'Missing leadId' })
        }

        const formData = await req.formData()
        const callStatus = formData.get('CallStatus') as string

        console.log(`[TWILIO STATUS CALLBACK] Lead ${leadId} status changed to:`, callStatus)

        // Map Twilio call status to CRM voice_call_status
        let dbStatus = 'calling'
        if (['completed'].includes(callStatus)) {
            dbStatus = 'completed'
        } else if (['failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
            dbStatus = 'failed'
        }

        if (dbStatus === 'failed') {
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'failed' })
                .eq('id', leadId)
            console.log(`[TWILIO STATUS CALLBACK] Updated lead ${leadId} to failed because call status is:`, callStatus)
            return NextResponse.json({ success: true })
        }

        if (dbStatus === 'completed') {
            // Fetch lead details and owner profile credentials
            const { data: lead } = await supabaseAdmin
                .from('leads')
                .select('id, name, phone, email, source, custom_fields, notes, pipeline_stage, user_id')
                .eq('id', leadId)
                .single()

            if (!lead) {
                console.error('[TWILIO STATUS CALLBACK] Lead not found:', leadId)
                return NextResponse.json({ success: false, error: 'Lead not found' })
            }

            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('id, elevenlabs_api_key, elevenlabs_agent_id, business_name')
                .eq('id', lead.user_id)
                .single()

            const elevenlabsApiKey = process.env.MASTER_ELEVENLABS_KEY || profile?.elevenlabs_api_key
            const elevenlabsAgentId = process.env.MASTER_ELEVENLABS_AGENT_ID || profile?.elevenlabs_agent_id

            let conversationId = null
            let transcript = []
            let summary = 'Call completed.'
            let callbackTime: string | null = null
            let isQualified = false
            let publicRecordingUrl = null

            if (elevenlabsApiKey && elevenlabsAgentId) {
                console.log('[TWILIO STATUS CALLBACK] Searching ElevenLabs for conversation logs...')
                
                // Retry loop to find the conversation as ElevenLabs finishes the session
                for (let attempt = 1; attempt <= 4; attempt++) {
                    try {
                        // Wait a short delay on retry attempts for ElevenLabs to write the logs
                        if (attempt > 1) await delay(3000)

                        const listUrl = `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${elevenlabsAgentId}&page_size=5`
                        const listRes = await fetch(listUrl, {
                            headers: { 'xi-api-key': elevenlabsApiKey }
                        })

                        if (!listRes.ok) {
                            console.error('[TWILIO STATUS CALLBACK] Failed to list conversations:', listRes.statusText)
                            continue
                        }

                        const listData = await listRes.json()
                        const conversations = listData.conversations || []

                        // Attempt to match the conversation to our lead
                        for (const conv of conversations) {
                            // Fetch details of each candidate conversation to see variables
                            const detailsRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conv.conversation_id}`, {
                                headers: { 'xi-api-key': elevenlabsApiKey }
                            })
                            if (!detailsRes.ok) continue

                            const details = await detailsRes.json()
                            const variables = details.conversation_initiation_client_data?.dynamic_variables || {}

                            // Match by lead_id or matched phone number
                            const isLeadMatch = variables.lead_id === leadId
                            const cleanLeadPhone = lead.phone ? lead.phone.replace(/\D/g, '') : ''
                            const isPhoneMatch = cleanLeadPhone && (
                                (details.phone_call?.agent_number && details.phone_call.agent_number.includes(cleanLeadPhone.slice(-10))) ||
                                (details.phone_call?.external_number && details.phone_call.external_number.includes(cleanLeadPhone.slice(-10)))
                            )

                            if (isLeadMatch || isPhoneMatch) {
                                conversationId = conv.conversation_id
                                transcript = details.transcript || []
                                break
                            }
                        }

                        if (conversationId) {
                            console.log(`[TWILIO STATUS CALLBACK] Matched conversation ID: ${conversationId} on attempt ${attempt}`)
                            break
                        }
                    } catch (err: any) {
                        console.error(`[TWILIO STATUS CALLBACK] Attempt ${attempt} failed:`, err.message)
                    }
                }
            }

            // 1. Perform Agentic Analysis using Gemini on the transcript if found
            if (conversationId && transcript.length > 0) {
                try {
                    const formattedTranscript = transcript
                        .map((t: any) => `${t.role === 'agent' ? 'Agent' : 'Lead'}: ${t.message}`)
                        .join('\n')

                    const geminiPrompt = `
You are analyzing a phone call transcript between an AI voice agent and a lead.
Here is the transcript:
${formattedTranscript}

Extract the following details as a valid JSON object ONLY. Do not use markdown tags, ticks, or backticks:
{
  "summary": "A clear, concise paragraph summary of the call",
  "callback_time": "ISO-8601 string of requested callback date/time if the lead explicitly asked to be called back at a specific time, otherwise null. Current system UTC time is: ${new Date().toISOString()}",
  "is_qualified": true/false (true if the lead confirmed interest, answered questions, agreed to a callback, or is qualified)
}
`

                    const rawGeminiRes = await callGemini(geminiPrompt)
                    const cleanJson = rawGeminiRes.replace(/```json/g, '').replace(/```/g, '').trim()
                    const extracted = JSON.parse(cleanJson)

                    summary = extracted.summary || summary
                    callbackTime = extracted.callback_time || null
                    isQualified = !!extracted.is_qualified
                } catch (err: any) {
                    console.error('[TWILIO STATUS CALLBACK] Gemini analysis extraction failed:', err)
                }
            }

            // 2. Download the audio recording from ElevenLabs if found
            if (conversationId && elevenlabsApiKey) {
                try {
                    const audioUrl = `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}/audio`
                    const audioRes = await fetch(audioUrl, {
                        headers: { 'xi-api-key': elevenlabsApiKey }
                    })

                    if (audioRes.ok) {
                        const audioBuffer = await audioRes.arrayBuffer()
                        const uploadPath = `${leadId}/${conversationId}.mp3`

                        const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
                            .from('lead-voice-recordings')
                            .upload(uploadPath, Buffer.from(audioBuffer), {
                                contentType: 'audio/mpeg',
                                upsert: true
                            })

                        if (uploadErr) {
                            console.error('[TWILIO STATUS CALLBACK] Audio upload error:', uploadErr)
                        } else if (uploadData) {
                            const { data: { publicUrl } } = supabaseAdmin.storage
                                .from('lead-voice-recordings')
                                .getPublicUrl(uploadPath)
                            publicRecordingUrl = publicUrl
                        }
                    } else {
                        console.warn('[TWILIO STATUS CALLBACK] Failed to download audio from ElevenLabs:', audioRes.statusText)
                    }
                } catch (audioErr) {
                    console.error('[TWILIO STATUS CALLBACK] Audio download/upload exception:', audioErr)
                }
            }

            // 3. Update the Lead Details in CRM
            const updateData: any = {
                voice_call_status: 'completed',
                voice_call_id: conversationId || undefined,
                voice_call_summary: conversationId ? summary : undefined,
                voice_call_transcript: conversationId ? transcript : undefined,
                voice_recording_url: publicRecordingUrl || undefined
            }

            // Prepend call summary to notes
            const dateStr = new Date().toLocaleDateString()
            let updatedNotes = `[🎙️ Voice Call - ${dateStr}]: ${summary}`
            if (lead.notes) {
                updatedNotes += `\n\n${lead.notes}`
            }
            updateData.notes = updatedNotes

            // Schedule callback if requested
            if (callbackTime) {
                updateData.voice_call_scheduled_at = callbackTime
                updateData.notes = `[⚠️ Scheduled Callback]: For ${new Date(callbackTime).toLocaleString()}\n\n` + updateData.notes
            }

            // Transition pipeline stage if qualified
            if (isQualified && lead.pipeline_stage !== 'Won') {
                updateData.pipeline_stage = 'Qualified'
            }

            const { error: updateErr } = await supabaseAdmin
                .from('leads')
                .update(updateData)
                .eq('id', leadId)

            if (updateErr) {
                console.error('[TWILIO STATUS CALLBACK] Database update failed:', updateErr)
                return NextResponse.json({ error: 'Database update failed.' }, { status: 500 })
            }

            // 4. Insert into lead_history so it displays on the Activity Log timeline
            try {
                const historyData = {
                    summary,
                    recording_url: publicRecordingUrl,
                    transcript
                }
                const { error: historyErr } = await supabaseAdmin
                    .from('lead_history')
                    .insert({
                        lead_id: leadId,
                        action_type: 'REMARK',
                        description: `🎙️ CALL_JSON:${JSON.stringify(historyData)}`
                    })
                if (historyErr) {
                    console.error('[TWILIO STATUS CALLBACK] Failed to insert lead history:', historyErr)
                }
            } catch (histErr) {
                console.error('[TWILIO STATUS CALLBACK] Exception inserting lead history:', histErr)
            }

            console.log(`[TWILIO STATUS CALLBACK] Successfully processed post-call details for lead ${leadId}`)
        }

        return NextResponse.json({ success: true })
    } catch (e: any) {
        console.error('[TWILIO STATUS CALLBACK] Error:', e.message)
        return NextResponse.json({ success: false, error: e.message })
    }
}
