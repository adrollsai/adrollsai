import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callGemini } from '@/utils/external-apis'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const body = await req.json()
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
                .select('id, user_id, notes, pipeline_stage')
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
                    .select('id, user_id, notes, pipeline_stage')
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
        let isQualified = false

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
                console.error('[ELEVENLABS WEBHOOK] Gemini analysis extraction failed:', err)
            }
        }

        // 3. Download the audio recording from ElevenLabs
        let publicRecordingUrl = null
        const elevenlabsApiKey = process.env.MASTER_ELEVENLABS_KEY || profile?.elevenlabs_api_key
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
        const updateData: any = {
            voice_call_status: 'completed',
            voice_call_id: conversationId,
            voice_call_summary: summary,
            voice_call_transcript: transcript,
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
