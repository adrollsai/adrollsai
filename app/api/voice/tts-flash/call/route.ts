import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { triggerVobizOutboundCall } from '@/utils/vobiz-helper'
import { resolveDialIdentity } from '@/utils/vobiz-dial-identity'
import { resolveTtsFlashBridgeHttpUrl } from '@/utils/app-url'
import { isIndianPhoneNumber } from '@/utils/phone-validation'
import { TTS_FLASH_MODELS, DEFAULT_TTS_FLASH_VOICE_ID, SUPPORTED_LANGUAGES } from '@/utils/tts-flash-config'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
)

const WHITELISTED_EMAILS = [
    'rchopra489@gmail.com',
    'infobluesquareinfra@gmail.com',
]

/**
 * Places a real outbound call through Vobiz that is answered by the
 * Gemini 3.8 Flash TTS pipeline (STT -> LLM -> streaming TTS, no Live API).
 *
 * Flow:
 *   1. create the prospect lead with the whole script brief in custom_fields
 *   2. pre-warm the bridge: it renders the opening line to PCM *before* the
 *      phone rings, so the greeting starts ~50ms after pickup
 *   3. dial via Vobiz with answerPath=/api/voice/vobiz/tts-flash-xml
 */
/**
 * Preflight: which line would this demo dial from, and does the carrier agree
 * that account owns it? The page shows this so nobody dials blind.
 */
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

        const dial = await resolveDialIdentity(user.id)
        if (!dial.ok) {
            return NextResponse.json({ ok: false, error: dial.error, ownedNumbers: dial.ownedNumbers || [] })
        }
        return NextResponse.json({
            ok: true,
            callerNumber: dial.identity.callerNumber,
            callerAccount: dial.identity.authId,
            source: dial.identity.source,
            ownedNumbers: dial.identity.ownedNumbers,
        })
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 })
        }

        // NOTE: profiles has no voice_vobiz_number column — the Vobiz caller ID
        // lives inside business_info. Selecting a non-existent column makes
        // PostgREST reject the whole row, which surfaced as a bogus
        // "Profile not found" error for a signed-in super admin.
        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, role, email, business_name, business_info, voice_twilio_number')
            .eq('id', user.id)
            .maybeSingle()

        if (profileErr) {
            console.error('[TTS-FLASH CALL] Profile lookup failed:', profileErr)
            return NextResponse.json({ error: 'Could not load your profile: ' + profileErr.message }, { status: 500 })
        }

        if (!profile) {
            return NextResponse.json({ error: 'No profile row exists for this account.' }, { status: 403 })
        }

        const isSuperAdmin = profile.role === 'super_admin' || WHITELISTED_EMAILS.includes(profile.email || '')
        if (!isSuperAdmin) {
            return NextResponse.json({ error: 'Forbidden. This demo is restricted to Nobogent admin accounts.' }, { status: 403 })
        }

        const body = await req.json()
        const {
            prospectName = '',
            prospectPhone = '',
            companyName = '',
            agentName = 'Aanya',
            language = 'hinglish',
            voiceId = '',
            reason = 'a property enquiry you had made',
            instruction = '',
            gender = 'female',
        } = body || {}

        const agentGender: 'female' | 'male' = gender === 'male' ? 'male' : 'female'

        // --- validation -----------------------------------------------------
        const cleanPhoneRaw = String(prospectPhone).replace(/[\s\-()]/g, '')
        let cleanPhone = cleanPhoneRaw.replace(/\D/g, '')
        if (cleanPhone.length === 10) cleanPhone = `+91${cleanPhone}`
        else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) cleanPhone = `+${cleanPhone}`
        else cleanPhone = `+${cleanPhone}`

        if (!isIndianPhoneNumber(cleanPhone)) {
            return NextResponse.json({
                error: 'Enter a valid Indian mobile number (10 digits, or +91XXXXXXXXXX). The carrier only dials +91 destinations.',
            }, { status: 400 })
        }
        if (!String(prospectName).trim()) {
            return NextResponse.json({ error: 'Prospect name is required — the AI greets them by name.' }, { status: 400 })
        }
        if (!SUPPORTED_LANGUAGES.some(l => l.id === language)) {
            return NextResponse.json({ error: 'Unsupported opening language.' }, { status: 400 })
        }

        const resolvedCompany = String(companyName).trim() || profile?.business_name || 'Nobogent Realty'
        const resolvedVoiceId = String(voiceId).trim() || process.env.TTS_FLASH_VOICE_ID || DEFAULT_TTS_FLASH_VOICE_ID

        // Caller ID + credentials: resolved from the carrier's own inventory so
        // a DID this account does not own can never reach the dial (that produced
        // "The from number ... is not owned by this account"). Checked before a
        // lead row is created, so a rejected preflight leaves nothing behind.
        const dial = await resolveDialIdentity(profile.id)
        if (!dial.ok) {
            return NextResponse.json({
                error: dial.error,
                ownedNumbers: dial.ownedNumbers || [],
                hint: 'Assign a Vobiz number to the voice account, or set TTS_FLASH_CALLER_NUMBER / TTS_FLASH_VOBIZ_AUTH_ID / TTS_FLASH_VOBIZ_AUTH_TOKEN.',
            }, { status: 400 })
        }
        const { authId: dialAuthId, authToken: dialAuthToken, callerNumber } = dial.identity

        console.log(`[TTS-FLASH CALL] ${prospectName} <${cleanPhone}> from ${callerNumber} as ${dialAuthId} [${dial.identity.source}] — voice=${resolvedVoiceId} lang=${language} gender=${agentGender}`)

        // --- 1. lead record -------------------------------------------------
        const { data: lead, error: leadErr } = await supabaseAdmin
            .from('leads')
            .insert({
                user_id: profile.id,
                name: String(prospectName).trim(),
                phone: cleanPhone,
                source: 'Gemini TTS Flash Demo',
                pipeline_stage: 'New Lead',
                status: 'New Lead',
                voice_call_status: 'calling',
                notes: `[🎧 Gemini 3.8 Flash TTS Pipeline Demo]\nCompany: ${resolvedCompany}\nAgent: ${agentName}\nOpening language: ${language}\nTriggered by: ${profile.email}`,
                custom_fields: {
                    is_demo_call: true,
                    skip_credit_deduction: true,
                    allow_after_hours: true,
                    pipeline: 'tts-flash',
                    prospect_name: String(prospectName).trim(),
                    company_name: resolvedCompany,
                    agent_name: agentName,
                    agent_gender: agentGender,
                    language,
                    reason: String(reason).trim() || 'a property enquiry you had made',
                    instruction: String(instruction).trim(),
                    tts_voice_id: resolvedVoiceId,
                    tts_model: TTS_FLASH_MODELS.tts,
                    asr_model: TTS_FLASH_MODELS.asr,
                    llm_model: TTS_FLASH_MODELS.llm,
                    triggered_by_admin: profile.email,
                    triggered_at: new Date().toISOString(),
                },
            })
            .select()
            .single()

        if (leadErr || !lead) {
            console.error('[TTS-FLASH CALL] Lead insert failed:', leadErr)
            return NextResponse.json({ error: 'Failed to create prospect record: ' + (leadErr?.message || 'unknown') }, { status: 500 })
        }

        // --- 2. pre-warm the pipeline while the phone is still silent -------
        const bridgeHttp = resolveTtsFlashBridgeHttpUrl()

        // The pipeline lives in the bridge. If that deployment does not expose
        // /tts-flash-stream yet, the prospect would answer a silent call — far
        // worse than a clear error here.
        try {
            const res = await fetch(`${bridgeHttp}/tts-flash-health`, {
                signal: AbortSignal.timeout(6000),
            })
            const health = res.ok ? await res.json().catch(() => null) : null
            if (!health?.ok) {
                await supabaseAdmin.from('leads').update({ voice_call_status: 'failed' }).eq('id', lead.id)
                return NextResponse.json({
                    error: 'The voice bridge has not been redeployed with the TTS-Flash pipeline yet, so the call would connect to silence.',
                    hint: `Run: cd voice-bridge && deploy.bat — then confirm ${bridgeHttp}/tts-flash-health returns {"ok":true}.`,
                }, { status: 409 })
            }
        } catch (healthErr: any) {
            await supabaseAdmin.from('leads').update({ voice_call_status: 'failed' }).eq('id', lead.id)
            return NextResponse.json({
                error: `Voice bridge unreachable at ${bridgeHttp} — not dialling, the caller would hear silence.`,
                hint: 'Start it locally (cd voice-bridge && npm start) or deploy it with deploy.bat.',
            }, { status: 409 })
        }

        let prewarm: any = { ok: false, skipped: true }
        try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 9000)
            const res = await fetch(`${bridgeHttp}/tts-flash-prewarm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadId: lead.id,
                    profileId: profile.id,
                    voiceId: resolvedVoiceId,
                    language,
                    gender: agentGender,
                    company: resolvedCompany,
                    prospectName: String(prospectName).trim(),
                    reason,
                    instruction,
                }),
                signal: controller.signal,
            })
            clearTimeout(timer)
            prewarm = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
            console.log('[TTS-FLASH CALL] Bridge prewarm:', JSON.stringify(prewarm).slice(0, 300))
        } catch (e: any) {
            console.warn('[TTS-FLASH CALL] Prewarm request failed (dialling anyway):', e.message)
            prewarm = { ok: false, error: e.message }
        }

        // --- 3. dial --------------------------------------------------------
        // By default the bridge serves its own answer webhook, so a real test
        // call only needs the bridge deployed — the web app does not have to be
        // in production. Set TTS_FLASH_XML_ON=app to answer via Next.js instead.
        const useNextAnswerRoute = process.env.TTS_FLASH_XML_ON === 'app'
        const vobizRes = await triggerVobizOutboundCall(supabaseAdmin, {
            leadId: lead.id,
            profileId: profile.id,
            toPhone: cleanPhone,
            fromPhone: callerNumber,
            customAuthId: dialAuthId,
            customAuthToken: dialAuthToken,
            allowAfterHours: true,
            skipCreditCheck: true,
            skipBridgeWarmup: true,
            answerPath: useNextAnswerRoute ? '/api/voice/vobiz/tts-flash-xml' : `${bridgeHttp}/tts-flash-xml`,
            answerParams: { voiceId: resolvedVoiceId, gender: agentGender },
        })

        if (!vobizRes.success && !vobizRes.scheduled) {
            console.error('[TTS-FLASH CALL] Dial failed:', vobizRes.error)
            await supabaseAdmin.from('leads').update({ voice_call_status: 'failed' }).eq('id', lead.id)
            return NextResponse.json({ error: vobizRes.error || 'Carrier rejected the call.' }, { status: 500 })
        }

        await supabaseAdmin.from('lead_history').insert({
            lead_id: lead.id,
            user_id: profile.id,
            action_type: 'REMARK',
            description: `🎧 Gemini 3.8 Flash TTS call placed to ${prospectName} (${cleanPhone}) from ${callerNumber} (${dialAuthId}). Voice ${resolvedVoiceId}, opener in ${language}. Pipeline: STT → LLM → streaming TTS (no Live API). Greeting pre-warmed: ${prewarm?.ok ? 'yes' : 'no'}.`,
        }).then(() => { }, () => { })

        return NextResponse.json({
            success: true,
            leadId: lead.id,
            callUuid: vobizRes.callUuid || null,
            callerNumber,
            callerAccount: dialAuthId,
            callerSource: dial.identity.source,
            ownedNumbers: dial.identity.ownedNumbers,
            voiceId: resolvedVoiceId,
            prewarmed: !!prewarm?.ok,
            prewarmMs: prewarm?.readyMs || null,
            greetingSec: prewarm?.greetingSec || null,
            bridge: bridgeHttp,
            models: TTS_FLASH_MODELS,
            message: `Dialing ${cleanPhone} — ${agentName} will open in ${language}.`,
        })
    } catch (e: any) {
        console.error('[TTS-FLASH CALL] Unexpected error:', e)
        return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
    }
}
