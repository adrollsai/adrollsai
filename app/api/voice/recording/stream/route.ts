import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureStandardMp3 } from '@/utils/audio-transcode'
import { resolveRecordingLinkSecret, verifyRecordingToken } from '@/lib/automation/call-receipt'
import { isOurRecording, signedRecordingUrl, RECORDING_BUCKET } from '@/lib/automation/recording-link'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** Hosts we are willing to fetch a recording from on the caller's behalf. */
function isCarrierMediaUrl(raw: string): boolean {
    try {
        const host = new URL(raw).hostname.toLowerCase()
        return (
            host === 'media.vobiz.ai' ||
            host.endsWith('.vobiz.ai') ||
            host === 'api.twilio.com' ||
            host.endsWith('.twilio.com') ||
            host.endsWith('.exotel.com')
        )
    } catch {
        return false
    }
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        let rawUrl = searchParams.get('url')
        const leadId = searchParams.get('leadId')

        // Signed links (the ones we email / WhatsApp to the owner) carry `exp`
        // and `sig`. When present they must verify, which keeps a mailed link a
        // bearer capability for one lead with a deadline instead of an open
        // handle on the storage bucket. Unsigned requests keep working: the
        // authenticated dashboard still links `?url=...&leadId=...` directly.
        const signature = searchParams.get('sig')
        const expiresAt = searchParams.get('exp')
        if (signature || expiresAt) {
            const valid = verifyRecordingToken({
                leadId,
                expiresAt: expiresAt ? Number(expiresAt) : null,
                signature,
                secret: resolveRecordingLinkSecret()
            })
            if (!valid) {
                return new NextResponse('Recording link is invalid or has expired', { status: 403 })
            }
            if (!leadId) {
                return new NextResponse('Recording link is missing the lead', { status: 400 })
            }
            // A signed link never lets the caller choose an arbitrary upstream
            // URL - it resolves through the lead only.
            rawUrl = null
        }

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

        // Our own bucket is PRIVATE, so the stored `.../object/public/...` string is
        // not playable for anyone. Redirect to a short-lived signed URL instead of
        // the public one; that is what makes this route the way to reach a recording
        // without the bucket being open to the world.
        if (isOurRecording(rawUrl)) {
            const signed = await signedRecordingUrl(supabaseAdmin, rawUrl)
            if (!signed) {
                return new NextResponse('Recording could not be signed', { status: 500 })
            }
            return NextResponse.redirect(signed, {
                headers: { 'Cache-Control': 'private, no-store' }
            })
        }

        // Anything that is not a carrier media URL and not ours has no business being
        // proxied: this route takes a `url` from the query string, and without this it
        // would fetch whatever it was handed (an open proxy / SSRF handle).
        if (!isCarrierMediaUrl(rawUrl)) {
            return new NextResponse('Unsupported recording source', { status: 400 })
        }

        // Carrier media URL: it requires X-Auth-ID and X-Auth-Token headers, which is
        // why it cannot simply be handed to a browser or to Meta.
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
                        .from(RECORDING_BUCKET)
                        .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true })

                    if (!upErr) {
                        // Store the OBJECT PATH, not a public URL. The bucket is
                        // private now, so a public URL would be a dead link; callers
                        // turn this path into a short-lived signed URL.
                        await supabaseAdmin
                            .from('leads')
                            .update({ voice_recording_url: storagePath })
                            .eq('id', leadId)
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
