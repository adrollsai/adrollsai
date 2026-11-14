import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { resolveTtsFlashBridgeHttpUrl } from '@/utils/app-url'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
)

/**
 * Live status for the Gemini TTS-Flash demo: call state, rolling transcript and
 * the per-turn latency numbers the bridge persisted at the end of the call.
 */
export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

        const url = new URL(req.url)
        const leadId = url.searchParams.get('leadId')
        const wantHealth = url.searchParams.get('health') === '1'

        let bridgeHealth: any = null
        if (wantHealth) {
            try {
                const controller = new AbortController()
                const timer = setTimeout(() => controller.abort(), 4000)
                const res = await fetch(`${resolveTtsFlashBridgeHttpUrl()}/tts-flash-health`, { signal: controller.signal })
                clearTimeout(timer)
                bridgeHealth = res.ok ? await res.json() : { ok: false, status: res.status }
            } catch (e: any) {
                bridgeHealth = { ok: false, error: e.message }
            }
        }

        if (!leadId) {
            const { data: recent } = await supabaseAdmin
                .from('leads')
                .select('id, name, phone, voice_call_status, voice_call_summary, created_at, custom_fields')
                .eq('source', 'Gemini TTS Flash Demo')
                .order('created_at', { ascending: false })
                .limit(15)
            return NextResponse.json({ success: true, recentCalls: recent || [], bridgeHealth })
        }

        const { data: lead } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, voice_call_status, voice_call_summary, voice_call_transcript, voice_recording_url, custom_fields, created_at')
            .eq('id', leadId)
            .maybeSingle()

        if (!lead) return NextResponse.json({ error: 'Call not found.' }, { status: 404 })

        const { data: history } = await supabaseAdmin
            .from('lead_history')
            .select('id, action_type, description, created_at')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: false })
            .limit(12)

        // The bridge stores the full transcript + latency profile as CALL_JSON.
        let callJson: any = null
        for (const row of history || []) {
            const match = /CALL_JSON:(\{[\s\S]*\})/.exec(row.description || '')
            if (match) {
                try { callJson = JSON.parse(match[1]); break } catch { /* malformed */ }
            }
        }

        let prewarm: any = null
        try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 3000)
            const res = await fetch(`${resolveTtsFlashBridgeHttpUrl()}/tts-flash-prewarm/status?leadId=${leadId}`, { signal: controller.signal })
            clearTimeout(timer)
            if (res.ok) prewarm = await res.json()
        } catch { /* bridge may be cold */ }

        return NextResponse.json({
            success: true,
            lead,
            history: history || [],
            callJson,
            prewarm,
            bridgeHealth,
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
    }
}
