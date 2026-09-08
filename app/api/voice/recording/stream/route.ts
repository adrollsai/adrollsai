import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureStandardMp3 } from '@/utils/audio-transcode'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        let rawUrl = searchParams.get('url')
        const leadId = searchParams.get('leadId')

        // If no direct URL passed, look up from lead
        if (!rawUrl && leadId) {
            const { data: lead } = await supabaseAdmin
                .from('leads')
                .select('voice_recording_url')
                .eq('id', leadId)
                .single()

            if (lead?.voice_recording_url) {
                rawUrl = lead.voice_recording_url
            } else {
                // Check lead_history
                const { data: hist } = await supabaseAdmin
                    .from('lead_history')
                    .select('description')
                    .eq('lead_id', leadId)
                    .ilike('description', '%recording_url%')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()

                if (hist?.description?.startsWith('🎙️ CALL_JSON:')) {
                    try {
                        const parsed = JSON.parse(hist.description.replace('🎙️ CALL_JSON:', '').trim())
                        if (parsed.recording_url) rawUrl = parsed.recording_url
                    } catch (e) {}
                }
            }
        }

        if (!rawUrl) {
            return new NextResponse('Recording not found', { status: 404 })
        }

        // If already a public Supabase URL or other public URL, redirect directly
        if (!rawUrl.includes('media.vobiz.ai')) {
            return NextResponse.redirect(rawUrl)
        }

        // Vobiz URL requires X-Auth-ID and X-Auth-Token headers
        const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
        const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'

        const vobizRes = await fetch(rawUrl, {
            headers: {
                'X-Auth-ID': authId,
                'X-Auth-Token': authToken
            }
        })

        if (!vobizRes.ok) {
            return new NextResponse(`Carrier media error: HTTP ${vobizRes.status}`, { status: vobizRes.status })
        }

        const rawBuffer = Buffer.from(await vobizRes.arrayBuffer())
        const audioBuffer = await ensureStandardMp3(rawBuffer)

        // In background, upload to Supabase storage so future plays are direct
        if (leadId) {
            (async () => {
                try {
                    const storagePath = `${leadId}/vobiz_${Date.now()}.mp3`
                    const { error: upErr } = await supabaseAdmin.storage
                        .from('lead-voice-recordings')
                        .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true })

                    if (!upErr) {
                        const { data: pubData } = supabaseAdmin.storage
                            .from('lead-voice-recordings')
                            .getPublicUrl(storagePath)

                        if (pubData?.publicUrl) {
                            await supabaseAdmin
                                .from('leads')
                                .update({ voice_recording_url: pubData.publicUrl })
                                .eq('id', leadId)
                        }
                    }
                } catch (bErr) {
                    console.warn('[RECORDING STREAM] Background upload to Supabase failed:', bErr)
                }
            })()
        }

        return new NextResponse(new Uint8Array(audioBuffer), {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': String(audioBuffer.length),
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=86400, s-maxage=86400',
                'Content-Disposition': 'inline; filename="call-recording.mp3"'
            }
        })
    } catch (err: any) {
        console.error('[RECORDING STREAM] Error proxying recording:', err)
        return new NextResponse('Internal server error', { status: 500 })
    }
}
