import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { TTS_FLASH_MODELS, DEFAULT_VOICE_DESIGN_DESCRIPTION } from '@/utils/tts-flash-config'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
)

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ''

async function requireAdmin() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }) }
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, role, email')
        .eq('id', user.id)
        .single()
    const ok = profile?.role === 'super_admin' || profile?.email === 'rchopra489@gmail.com'
    if (!ok) return { error: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) }
    return { profile }
}

/**
 * Voice design for the TTS-Flash pipeline.
 *
 * Voices are "prompted" personas stored on the project (POST /v1beta/voices):
 * permanent traits only — age, timbre, accent, polyglot range. The returned
 * voice_... id is then passed straight into every streaming TTS request.
 */
export async function GET() {
    const gate = await requireAdmin()
    if (gate.error) return gate.error

    try {
        const res = await fetch(`${GEMINI_BASE}/voices?type=prompted&pageSize=50`, {
            headers: { 'x-goog-api-key': apiKey() },
        })
        const json = await res.json().catch(() => ({}))
        const voices = (json.voices || []).map((v: any) => ({
            id: v.id,
            name: v.display_name || v.id,
            language: v.language_code || null,
            gender: v.gender || null,
            expires: v.expire_time || null,
        }))
        return NextResponse.json({ success: true, voices, model: TTS_FLASH_MODELS.tts })
    } catch (e: any) {
        return NextResponse.json({ success: false, voices: [], error: e.message })
    }
}

export async function POST(req: Request) {
    const gate = await requireAdmin()
    if (gate.error) return gate.error

    try {
        const body = await req.json().catch(() => ({}))
        const description = String(body?.description || DEFAULT_VOICE_DESIGN_DESCRIPTION).trim()
        const displayName = String(body?.displayName || 'Nobo Real Estate Advisor').slice(0, 60)
        const gender = body?.gender === 'male' ? 'male' : 'female'

        if (description.length < 30) {
            return NextResponse.json({ error: 'Describe the voice in at least a sentence (age, timbre, accent, languages).' }, { status: 400 })
        }

        const startedAt = Date.now()
        const res = await fetch(`${GEMINI_BASE}/voices`, {
            method: 'POST',
            headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store: true,
                voice: {
                    model: TTS_FLASH_MODELS.tts,
                    type: 'prompted',
                    display_name: displayName,
                    gender,
                    language_code: 'en-IN',
                    prompted: { input: description },
                },
            }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json.id) {
            return NextResponse.json({
                error: `Voice design failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`,
            }, { status: 502 })
        }

        return NextResponse.json({
            success: true,
            voiceId: json.id,
            displayName: json.display_name || displayName,
            model: TTS_FLASH_MODELS.tts,
            tookMs: Date.now() - startedAt,
            sampleAudio: json.sample_audio?.data || null,
            sampleMime: json.sample_audio?.mime_type || json.sample_audio?.mimeType || 'audio/wav',
            expires: json.expire_time || null,
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Voice design failed' }, { status: 500 })
    }
}
