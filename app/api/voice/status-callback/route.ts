import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callGemini } from '@/utils/external-apis'
import { bookAppointment } from '@/utils/voice-helper'

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
            const { data: leadData } = await supabaseAdmin
                .from('leads')
                .select('voice_call_retry_count, notes')
                .eq('id', leadId)
                .single()

            const currentRetries = leadData?.voice_call_retry_count || 0
            if (currentRetries < 3) {
                const nextRetryCount = currentRetries + 1
                let delayMinutes = 30
                if (nextRetryCount === 2) delayMinutes = 120
                if (nextRetryCount === 3) delayMinutes = 360

                const scheduledTime = new Date(Date.now() + delayMinutes * 60000).toISOString()
                let updatedNotes = `[⚠️ Call Rescheduled]: Call retry #${nextRetryCount} scheduled for ${new Date(scheduledTime).toLocaleString()} (Reason: ${callStatus})`
                if (leadData?.notes) {
                    updatedNotes += `\n\n${leadData.notes}`
                }

                await supabaseAdmin
                    .from('leads')
                    .update({
                        voice_call_status: 'scheduled_retry',
                        voice_call_scheduled_at: scheduledTime,
                        voice_call_retry_count: nextRetryCount,
                        notes: updatedNotes
                    })
                    .eq('id', leadId)

                await supabaseAdmin
                    .from('lead_history')
                    .insert({
                        lead_id: leadId,
                        action_type: 'REMARK',
                        description: `⚠️ Outbound call was unanswered/busy (${callStatus}). Scheduled retry #${nextRetryCount} in ${delayMinutes} minutes.`
                    })

                console.log(`[TWILIO STATUS CALLBACK] Rescheduled lead ${leadId} to retry #${nextRetryCount} in ${delayMinutes} mins.`)
            } else {
                let updatedNotes = `[❌ Call Failed]: Max calling retry limit reached (3 attempts). Auto-calling stopped.`
                if (leadData?.notes) {
                    updatedNotes += `\n\n${leadData.notes}`
                }

                await supabaseAdmin
                    .from('leads')
                    .update({
                        voice_call_status: 'failed',
                        voice_call_scheduled_at: null,
                        notes: updatedNotes
                    })
                    .eq('id', leadId)

                await supabaseAdmin
                    .from('lead_history')
                    .insert({
                        lead_id: leadId,
                        action_type: 'REMARK',
                        description: `❌ Call failed after maximum retry attempts (3).`
                    })

                console.log(`[TWILIO STATUS CALLBACK] Updated lead ${leadId} to final failed status. Max retries reached.`)
            }
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
                .select('id, elevenlabs_api_key, elevenlabs_agent_id, business_name, voice_provider, voice_twilio_sid, voice_twilio_token')
                .eq('id', lead.user_id)
                .single()

            const voiceProvider = profile?.voice_provider || 'elevenlabs'
            const elevenlabsApiKey = process.env.MASTER_ELEVENLABS_KEY || profile?.elevenlabs_api_key
            const elevenlabsAgentId = process.env.MASTER_ELEVENLABS_AGENT_ID || profile?.elevenlabs_agent_id

            let conversationId = null
            let transcript = []
            let summary = 'Call completed.'
            let callbackTime: string | null = null
            let bookingTime: string | null = null
            let isQualified = false
            let publicRecordingUrl = null

            // 1. Fetch ElevenLabs logs if provider is ElevenLabs
            if (voiceProvider !== 'gemini' && elevenlabsApiKey && elevenlabsAgentId) {
                console.log('[TWILIO STATUS CALLBACK] Searching ElevenLabs for conversation logs...')
                
                // Retry loop to find the conversation as ElevenLabs finishes the session
                for (let attempt = 1; attempt <= 6; attempt++) {
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
                                const detailsTranscript = details.transcript || []
                                if (detailsTranscript.length > 0) {
                                    conversationId = conv.conversation_id
                                    transcript = detailsTranscript
                                    break
                                } else {
                                    console.log(`[TWILIO STATUS CALLBACK] Matched conversation ${conv.conversation_id} but transcript is not yet populated. Retrying...`)
                                }
                            }
                        }

                        if (conversationId && transcript.length > 0) {
                            console.log(`[TWILIO STATUS CALLBACK] Matched conversation ID: ${conversationId} with transcript on attempt ${attempt}`)
                            break
                        } else {
                            // Clear conversationId to continue retry attempts if transcript is empty
                            conversationId = null
                        }
                    } catch (err: any) {
                        console.error(`[TWILIO STATUS CALLBACK] Attempt ${attempt} failed:`, err.message)
                    }
                }
            }

            // 2. Perform Agentic Analysis using Gemini on the transcript if ElevenLabs transcript was found
            if (voiceProvider !== 'gemini' && conversationId && transcript.length > 0) {
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
  "callback_time": "ISO-8601 string of requested callback date/time if the lead asked or agreed to be called back at a specific time (including accepting or saying 'okay', 'thank you', 'theek hai' after a callback time is proposed by the agent), otherwise null. Current system UTC time is: ${new Date().toISOString()}",
  "booking_time": "ISO-8601 string of the agreed appointment/meeting/consultation slot if the lead agreed to, confirmed, or accepted a proposed meeting slot (including saying 'okay', 'thank you', 'theek hai', or saying goodbye/thank you after a meeting slot is proposed/confirmed by the agent), otherwise null. Current system UTC time is: ${new Date().toISOString()}",
  "is_qualified": true/false (true if the lead confirmed interest, answered questions, agreed to a callback, or is qualified)
}
`

                    const rawGeminiRes = await callGemini(geminiPrompt)
                    const cleanJson = rawGeminiRes.replace(/```json/g, '').replace(/```/g, '').trim()
                    const extracted = JSON.parse(cleanJson)

                    summary = extracted.summary || summary
                    callbackTime = extracted.callback_time || null
                    bookingTime = extracted.booking_time || null
                    isQualified = !!extracted.is_qualified
                } catch (err: any) {
                    console.error('[TWILIO STATUS CALLBACK] Gemini analysis extraction failed:', err)
                }
            }

            // 3. Download the audio recording from ElevenLabs if provider is ElevenLabs
            if (voiceProvider !== 'gemini' && conversationId && elevenlabsApiKey) {
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

            // 4. Download recording from Twilio if provider is Gemini
            if (voiceProvider === 'gemini') {
                const recordingUrl = formData.get('RecordingUrl') as string
                if (recordingUrl) {
                    console.log('[TWILIO STATUS CALLBACK] Twilio Call Recording found. Downloading...', recordingUrl)
                    try {
                        const twilioSid = process.env.MASTER_TWILIO_SID || profile?.voice_twilio_sid
                        const twilioToken = process.env.MASTER_TWILIO_TOKEN || profile?.voice_twilio_token
                        const twilioAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')

                        const recordingRes = await fetch(recordingUrl, {
                            headers: {
                                'Authorization': `Basic ${twilioAuth}`
                            }
                        })

                        if (recordingRes.ok) {
                            const audioBuffer = await recordingRes.arrayBuffer()
                            const callSid = formData.get('CallSid') as string || 'gemini_call'
                            const uploadPath = `${leadId}/${callSid}.wav`

                            const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
                                .from('lead-voice-recordings')
                                .upload(uploadPath, Buffer.from(audioBuffer), {
                                    contentType: 'audio/wav',
                                    upsert: true
                                })

                            if (uploadErr) {
                                console.error('[TWILIO STATUS CALLBACK] Gemini audio upload error:', uploadErr)
                            } else if (uploadData) {
                                const { data: { publicUrl } } = supabaseAdmin.storage
                                    .from('lead-voice-recordings')
                                    .getPublicUrl(uploadPath)
                                publicRecordingUrl = publicUrl
                                console.log('[TWILIO STATUS CALLBACK] Gemini call recording saved to Supabase Storage:', publicRecordingUrl)
                            }
                        } else {
                            console.error('[TWILIO STATUS CALLBACK] Failed to download audio from Twilio:', recordingRes.statusText)
                        }
                    } catch (audioErr) {
                        console.error('[TWILIO STATUS CALLBACK] Gemini audio download exception:', audioErr)
                    }
                }
            }

            // 5. Update the Lead Details in CRM
            const updateData: any = {
                voice_call_status: 'completed',
                voice_call_retry_count: 0 // Reset retry count since call was picked up
            }

            if (publicRecordingUrl) {
                updateData.voice_recording_url = publicRecordingUrl
            }

            if (voiceProvider !== 'gemini') {
                updateData.voice_call_id = conversationId || undefined
                updateData.voice_call_summary = conversationId ? summary : undefined
                updateData.voice_call_transcript = conversationId ? transcript : undefined

                // Prepend call summary to notes
                const dateStr = new Date().toLocaleDateString()
                let updatedNotes = `[🎙️ Voice Call - ${dateStr}]: ${summary}`
                if (lead.notes) {
                    updatedNotes += `\n\n${lead.notes}`
                }
                updateData.notes = updatedNotes

                // Schedule callback if requested, otherwise clear the past scheduled time
                updateData.voice_call_scheduled_at = callbackTime || null
                if (callbackTime) {
                    updateData.notes = `[⚠️ Scheduled Callback]: For ${new Date(callbackTime).toLocaleString()}\n\n` + updateData.notes
                }

                // Transition pipeline stage if qualified
                if (isQualified && lead.pipeline_stage !== 'Won' && !bookingTime) {
                    updateData.pipeline_stage = 'Qualified'
                }
            }

            const { error: updateErr } = await supabaseAdmin
                .from('leads')
                .update(updateData)
                .eq('id', leadId)

            if (voiceProvider !== 'gemini' && !updateErr && bookingTime) {
                console.log(`[TWILIO STATUS CALLBACK] Call led to booking slot ${bookingTime}. Triggering bookAppointment...`)
                await bookAppointment(supabaseAdmin, leadId, bookingTime, lead.user_id)
            }

            if (updateErr) {
                console.error('[TWILIO STATUS CALLBACK] Database update failed:', updateErr)
                return NextResponse.json({ error: 'Database update failed.' }, { status: 500 })
            }

            // 6. Save or update timeline history logs
            if (voiceProvider === 'gemini' && publicRecordingUrl) {
                try {
                    // Update latest REMARK timeline event with Gemini recording URL
                    const { data: histRecords } = await supabaseAdmin
                        .from('lead_history')
                        .select('id, description')
                        .eq('lead_id', leadId)
                        .eq('action_type', 'REMARK')
                        .order('created_at', { ascending: false })
                        .limit(3)

                    if (histRecords) {
                        const targetRecord = histRecords.find(r => r.description.startsWith('🎙️ CALL_JSON:'))
                        if (targetRecord) {
                            const rawJson = targetRecord.description.replace('🎙️ CALL_JSON:', '')
                            const parsed = JSON.parse(rawJson)
                            parsed.recording_url = publicRecordingUrl
                            
                            await supabaseAdmin
                                .from('lead_history')
                                .update({
                                    description: `🎙️ CALL_JSON:${JSON.stringify(parsed)}`
                                })
                                .eq('id', targetRecord.id)
                            
                            console.log('[TWILIO STATUS CALLBACK] Updated lead history record with Gemini recording URL.')
                        }
                    }
                } catch (histErr) {
                    console.error('[TWILIO STATUS CALLBACK] Failed to update lead history with Gemini recording URL:', histErr)
                }
            } else if (voiceProvider !== 'gemini') {
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
            }

            console.log(`[TWILIO STATUS CALLBACK] Successfully processed post-call details for lead ${leadId}`)
        }

        return NextResponse.json({ success: true })
    } catch (e: any) {
        console.error('[TWILIO STATUS CALLBACK] Error:', e.message)
        return NextResponse.json({ success: false, error: e.message })
    }
}
