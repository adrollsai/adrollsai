import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callGemini } from '@/utils/external-apis'
import { bookAppointment } from '@/utils/voice-helper'
import crypto from 'crypto'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const bodyText = await req.text()

        // Webhook signature verification if secret and header are present
        const signature = req.headers.get('ElevenLabs-Signature') || req.headers.get('elevenlabs-signature')
        const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET

        if (webhookSecret && signature) {
            const secrets = webhookSecret.split(',').map(s => s.trim())
            let isValid = false
            for (const secret of secrets) {
                const computedSig = crypto
                    .createHmac('sha256', secret)
                    .update(bodyText)
                    .digest('hex')
                if (computedSig === signature) {
                    isValid = true
                    break
                }
            }

            if (!isValid) {
                console.error('[ELEVENLABS WEBHOOK] Signature verification failed.')
                return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
            }
            console.log('[ELEVENLABS WEBHOOK] Signature verified successfully.')
        }

        const body = JSON.parse(bodyText)
        console.log('[ELEVENLABS WEBHOOK] Received payload event:', body.type)

        // Only process post-call transcriptions
        if (body.type !== 'post_call_transcription') {
            return NextResponse.json({ success: true, message: 'Ignored event type.' })
        }

        const data = body.data || {}
        const conversationId = data.conversation_id
        const agentId = data.agent_id
        const transcript = data.transcript || []

        if (!conversationId || !agentId) {
            return NextResponse.json({ error: 'Missing conversation or agent identifiers.' }, { status: 400 })
        }

        // 1. Identify the lead
        let leadId = data.conversation_initiation_client_data?.dynamic_variables?.lead_id
        let lead = null
        let profile = null

        console.log('[ELEVENLABS WEBHOOK] Extracted leadId:', leadId)

        // 1. Resolve lead first
        if (leadId) {
            const { data: matchedLead, error: matchErr } = await supabaseAdmin
                .from('leads')
                .select('id, user_id, notes, pipeline_stage, voice_call_retry_count, custom_fields')
                .eq('id', leadId)
                .single()
            
            if (matchErr) {
                console.error('[ELEVENLABS WEBHOOK] Error matching lead by ID:', matchErr)
            }
            if (matchedLead) {
                lead = matchedLead
                console.log('[ELEVENLABS WEBHOOK] Successfully matched lead:', matchedLead)
            }
        }

        // Fallback: search lead by phone if leadId was not in variables
        if (!lead) {
            const callerPhone = data.metadata?.caller_id || ''
            if (callerPhone) {
                const cleanPhone = callerPhone.replace(/\D/g, '')
                const { data: matchedLeads } = await supabaseAdmin
                    .from('leads')
                    .select('id, user_id, notes, pipeline_stage, voice_call_retry_count, custom_fields')
                    .ilike('phone', `%${cleanPhone.slice(-10)}%`)
                    .limit(1)

                if (matchedLeads?.[0]) {
                    lead = matchedLeads[0]
                    leadId = lead.id
                }
            }
        }

        if (!lead) {
            console.error('[ELEVENLABS WEBHOOK] Could not map conversation to any lead:', conversationId)
            return NextResponse.json({ error: 'Lead mapping failed.' }, { status: 404 })
        }

        // 2. Fetch owner profile credentials
        const { data: matchedProfile } = await supabaseAdmin
            .from('profiles')
            .select('id, elevenlabs_api_key')
            .eq('id', lead.user_id)
            .single()

        if (matchedProfile) {
            profile = matchedProfile
        }

        if (!profile) {
            console.error('[ELEVENLABS WEBHOOK] Profile not found for owner user:', lead.user_id)
            return NextResponse.json({ error: 'Associated profile not found.' }, { status: 404 })
        }

        // 2. Perform Agentic Analysis using Gemini on the transcript
        let summary = 'Call completed.'
        let callbackTime: string | null = null
        let bookingTime: string | null = null
        let isQualified = false
        let extractedAllowAfterHours = false
        let extractedCallingEnabled = true

        if (transcript.length > 0) {
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
  "summary": "A detailed summary of the conversation highlighting the key points, lead's requirements or objections, questions asked, and any agreed next steps or appointments.",
  "callback_time": "ISO-8601 string of requested callback date/time if the lead asked or agreed to be called back at a specific time (including accepting or saying 'okay', 'thank you', 'theek hai' after a callback time is proposed by the agent), otherwise null. Current system UTC time is: ${new Date().toISOString()}",
  "booking_time": "ISO-8601 string of the agreed appointment/meeting/consultation slot if the lead agreed to, confirmed, or accepted a proposed meeting slot (including saying 'okay', 'thank you', 'theek hai', or saying goodbye/thank you after a meeting slot is proposed/confirmed by the agent), otherwise null. Current system UTC time is: ${new Date().toISOString()}",
  "is_qualified": true/false (true if the lead confirmed interest, answered questions, agreed to a callback, or is qualified),
  "allow_after_hours": true/false (true if the prospect explicitly requested, suggested, agreed, or said it is okay to call them back after 7 PM local time, late, at night, or at any time in general, otherwise false),
  "calling_enabled": true/false (false if the lead explicitly requested to never be called again, asked to stop calling, or requested to opt out/be removed from the calling list, otherwise true),
  "unanswered_questions": ["array of raw question strings that the AI assistant was unable to answer because it lacked info in context, or empty array if none"]
}
`

                const rawGeminiRes = await callGemini(geminiPrompt)
                const cleanJson = rawGeminiRes.replace(/```json/g, '').replace(/```/g, '').trim()
                const extracted = JSON.parse(cleanJson)

                summary = extracted.summary || summary
                callbackTime = extracted.callback_time || null
                bookingTime = extracted.booking_time || null
                isQualified = !!extracted.is_qualified
                extractedAllowAfterHours = !!extracted.allow_after_hours
                if (extracted.calling_enabled === false) {
                    extractedCallingEnabled = false
                }

                if (extracted.unanswered_questions && Array.isArray(extracted.unanswered_questions) && extracted.unanswered_questions.length > 0) {
                    const inserts = extracted.unanswered_questions.map((q: string) => ({
                        user_id: lead.user_id,
                        lead_id: leadId,
                        channel: 'voice',
                        question: q
                    }));
                    await supabaseAdmin.from('flagged_questions').insert(inserts);
                    console.log('[ELEVENLABS WEBHOOK] Inserted flagged questions from ElevenLabs transcript:', inserts);
                }
            } catch (err: any) {
                console.error('[ELEVENLABS WEBHOOK] Gemini analysis extraction failed:', err)
            }
        }

        // 3. Download the audio recording from ElevenLabs
        let publicRecordingUrl = null
        const elevenlabsApiKey = profile?.elevenlabs_api_key || process.env.MASTER_ELEVENLABS_KEY
        if (elevenlabsApiKey) {
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
                        console.error('[ELEVENLABS WEBHOOK] Audio upload error:', uploadErr)
                    } else if (uploadData) {
                        const { data: { publicUrl } } = supabaseAdmin.storage
                            .from('lead-voice-recordings')
                            .getPublicUrl(uploadPath)
                        publicRecordingUrl = publicUrl
                    }
                } else {
                    console.warn('[ELEVENLABS WEBHOOK] Failed to download audio from ElevenLabs:', audioRes.statusText)
                }
            } catch (audioErr) {
                console.error('[ELEVENLABS WEBHOOK] Audio download/upload exception:', audioErr)
            }
        }

        // 4. Update the Lead Details in CRM
        const currentRetryCount = lead.voice_call_retry_count || 0
        const MAX_TOTAL_ATTEMPTS = 5

        let customFieldsObj: any = {}
        if (lead?.custom_fields) {
            if (typeof lead.custom_fields === 'string') {
                try {
                    customFieldsObj = JSON.parse(lead.custom_fields)
                } catch (e) {
                    customFieldsObj = {}
                }
            } else if (typeof lead.custom_fields === 'object') {
                customFieldsObj = lead.custom_fields
            }
        }

        const customFields = {
            ...customFieldsObj
        }
        if (extractedAllowAfterHours) {
            customFields.allow_after_hours = true
        }

        const updateData: any = {
            voice_call_status: 'completed',
            voice_call_id: conversationId,
            voice_call_summary: summary,
            voice_call_transcript: transcript,
            voice_recording_url: publicRecordingUrl || null,
            voice_call_retry_count: 0, // Default: reset retry count since they picked up and call is completed
            custom_fields: customFields
        }
        if (extractedCallingEnabled === false) {
            updateData.calling_enabled = false
        }

        // Prepend call summary to notes
        const dateStr = new Date().toLocaleDateString()
        let updatedNotes = `[🎙️ Voice Call - ${dateStr}]: ${summary}`
        if (lead.notes) {
            updatedNotes += `\n\n${lead.notes}`
        }
        updateData.notes = updatedNotes

        // Schedule callback if requested, otherwise clear the past scheduled time
        if (callbackTime && currentRetryCount + 1 < MAX_TOTAL_ATTEMPTS) {
            // Callback requested and we haven't hit the total attempt cap
            updateData.voice_call_scheduled_at = callbackTime
            updateData.voice_call_status = 'scheduled_callback'
            updateData.voice_call_retry_count = currentRetryCount + 1 // Preserve & increment across callback chains
            updateData.notes = `[⚠️ Scheduled Callback]: For ${new Date(callbackTime).toLocaleString()}\n\n` + updateData.notes
            console.log(`[ELEVENLABS WEBHOOK] Callback scheduled for lead ${leadId}. Total attempt count: ${currentRetryCount + 1}/${MAX_TOTAL_ATTEMPTS}`)
        } else if (callbackTime) {
            // Callback requested but max total attempts reached — stop calling
            updateData.voice_call_scheduled_at = null
            updateData.voice_call_status = 'completed'
            updateData.voice_call_retry_count = currentRetryCount + 1
            updateData.notes = `[⚠️ Callback Skipped]: Lead requested callback but max total call attempts (${MAX_TOTAL_ATTEMPTS}) reached. Auto-calling stopped.\n\n` + updateData.notes
            console.log(`[ELEVENLABS WEBHOOK] Callback requested but max attempts (${MAX_TOTAL_ATTEMPTS}) reached for lead ${leadId}. Not scheduling.`)
        } else {
            // Check if call was a no-reply (lead did not speak a single word in transcript)
            let leadSpoke = false
            if (transcript && Array.isArray(transcript)) {
                leadSpoke = transcript.some((t: any) => {
                    const role = t.role || ''
                    const message = t.message || ''
                    return (role === 'user' || role === 'lead') && /[a-zA-Z0-9\u0900-\u097F]/.test(message)
                })
            }

            const isNoReply = !leadSpoke

            if (isNoReply) {
                if (currentRetryCount + 1 < MAX_TOTAL_ATTEMPTS) {
                    const nextRetryCount = currentRetryCount + 1
                    let delayMinutes = 30
                    if (nextRetryCount === 2) delayMinutes = 120
                    if (nextRetryCount === 3) delayMinutes = 360
                    
                    const scheduledTime = new Date(Date.now() + delayMinutes * 60000).toISOString()
                    updateData.voice_call_scheduled_at = scheduledTime
                    updateData.voice_call_status = 'scheduled_retry'
                    updateData.voice_call_retry_count = nextRetryCount
                    updateData.notes = `[⚠️ Call Rescheduled]: Call retry #${nextRetryCount} scheduled for ${new Date(scheduledTime).toLocaleString()} (Reason: Connected but lead hung up without speaking)\n\n` + updateData.notes
                    console.log(`[ELEVENLABS WEBHOOK] Lead ${leadId} connected but hung up without speaking. Scheduled retry #${nextRetryCount} in ${delayMinutes} mins.`)
                } else {
                    updateData.voice_call_scheduled_at = null
                    updateData.voice_call_status = 'failed'
                    updateData.notes = `[❌ Call Failed]: Max calling retry limit reached (5 attempts). Auto-calling stopped.\n\n` + updateData.notes
                    console.log(`[ELEVENLABS WEBHOOK] Lead ${leadId} connected but hung up without speaking, and max attempts reached. Auto-calling stopped.`)
                }
            } else {
                // No callback requested & lead spoke — call is truly done
                updateData.voice_call_scheduled_at = null
                updateData.voice_call_retry_count = 0
            }
        }

        // Transition pipeline stage if booked or ongoing
        if (bookingTime) {
            updateData.status = 'Appointment Booked'
            updateData.pipeline_stage = 'Appointment Booked'
            updateData.booked_time = bookingTime
        } else {
            if (!lead.pipeline_stage || lead.pipeline_stage === 'New Lead' || lead.pipeline_stage === 'New' || lead.status === 'New Lead' || lead.status === 'New') {
                updateData.status = 'Ongoing'
                updateData.pipeline_stage = 'Ongoing'
            }
        }

        const { error: updateErr } = await supabaseAdmin
            .from('leads')
            .update(updateData)
            .eq('id', leadId)

        if (!updateErr && bookingTime) {
            console.log(`[ELEVENLABS WEBHOOK] Call led to booking slot ${bookingTime}. Triggering bookAppointment...`)
            await bookAppointment(supabaseAdmin, leadId, bookingTime, lead.user_id, true)
        }

        if (updateErr) {
            console.error('[ELEVENLABS WEBHOOK] Database update failed:', updateErr)
            return NextResponse.json({ error: 'Database update failed.' }, { status: 500 })
        }

        // Insert into lead_history so it displays on the Activity Log timeline
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
                console.error('[ELEVENLABS WEBHOOK] Failed to insert lead history:', historyErr)
            }
        } catch (histErr) {
            console.error('[ELEVENLABS WEBHOOK] Exception inserting lead history:', histErr)
        }

        return NextResponse.json({ success: true, message: 'Webhook call processed.' })
    } catch (e: any) {
        console.error('[ELEVENLABS WEBHOOK] Handler Exception:', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
