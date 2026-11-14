import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { TTS_FLASH_MODELS, DEFAULT_TTS_FLASH_VOICE_ID } from '@/utils/tts-flash-config'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
)

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ''

/**
 * Renders a line with the designed voice so the demo page can audition the
 * polyglot persona in the browser — same model and same voice id the live call
 * uses, just returned as a WAV instead of streamed to the carrier.
 */
export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('role, email')
            .eq('id', user.id)
            .single()
        const ok = profile?.role === 'super_admin' || profile?.email === 'rchopra489@gmail.com'
        if (!ok) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

        const body = await req.json().catch(() => ({}))
        const text = String(body?.text || '').trim().slice(0, 600)
        const voiceId = String(body?.voiceId || '').trim() || process.env.TTS_FLASH_VOICE_ID || DEFAULT_TTS_FLASH_VOICE_ID
        if (!text) return NextResponse.json({ error: 'Nothing to say.' }, { status: 400 })

        const startedAt = Date.now()
        const res = await fetch(`${GEMINI_BASE}/models/${TTS_FLASH_MODELS.tts}:generateContent`, {
            method: 'POST',
            headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } },
                },
            }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
            return NextResponse.json({
                error: `TTS failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`,
            }, { status: 502 })
        }

        const inline = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData
        if (!inline?.data) {
            return NextResponse.json({ error: 'Model returned no audio.' }, { status: 502 })
        }

        return NextResponse.json({
            success: true,
            audio: inline.data,
            mime: inline.mimeType || 'audio/wav',
            voiceId,
            model: TTS_FLASH_MODELS.tts,
            tookMs: Date.now() - startedAt,
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Preview failed' }, { status: 500 })
    }
}
