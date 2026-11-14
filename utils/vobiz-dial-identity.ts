import { createClient } from '@supabase/supabase-js'

/**
 * Resolves which Vobiz line (and which account credentials) the TTS-Flash demo
 * should dial from, and proves the carrier actually owns that line before we
 * touch the prospect's phone.
 *
 * Why this exists
 * ---------------
 * The dial failed with "The from number 911171366938 is not owned by this
 * account". The demo was dialling with the signed-in profile's credentials
 * (Nobogent, master account MA_HOSGFZ86) while presenting a caller ID from
 * VOBIZ_TEST_NUMBER — a number that account does not own. Vobiz rejects that
 * combination outright, and the only thing the operator sees is a scary toast.
 *
 * Resolution order:
 *   1. explicit env overrides (TTS_FLASH_CALLER_NUMBER + TTS_FLASH_VOBIZ_AUTH_*)
 *   2. the designated voice account profile (default: Blue Square Infra, which
 *      owns +917965480905 on sub-account SA_RUY0ZNCH)
 *   3. the signed-in profile's own business_info credentials/number
 * ...and in every case the chosen number is validated against the carrier's
 * own number list, falling back to any voice-capable number that account owns.
 */

const supabaseAdmin = () =>
    createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
    )

export interface DialIdentity {
    authId: string
    authToken: string
    callerNumber: string
    source: string
    /** Every number this account may legitimately present as caller ID. */
    ownedNumbers: string[]
}

interface BizInfo {
    voice_vobiz_number?: string
    claimed_vobiz_number?: string
    voice_vobiz_auth_id?: string
    voice_vobiz_auth_token?: string
    kyc_data?: { vobizSubAuthId?: string }
}

function parseBizInfo(raw: unknown): BizInfo {
    if (!raw) return {}
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) } catch { return {} }
    }
    return raw as BizInfo
}

function normalize(number: string): string {
    const digits = String(number || '').replace(/\D/g, '')
    return digits ? `+${digits}` : ''
}

/** Owned, voice-capable DIDs for an account, per the carrier. */
export async function listOwnedNumbers(authId: string, authToken: string): Promise<string[]> {
    try {
        const res = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/numbers`, {
            headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken },
            signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) return []
        const json = await res.json().catch(() => ({}))
        const items: any[] = json.items || json.objects || json.numbers || []
        return items
            .filter(n => n?.capabilities?.voice !== false)
            .map(n => normalize(n.e164 || n.number || ''))
            .filter(Boolean)
    } catch {
        return []
    }
}

export async function resolveDialIdentity(profileId: string): Promise<
    | { ok: true; identity: DialIdentity }
    | { ok: false; error: string; ownedNumbers?: string[] }
> {
    const db = supabaseAdmin()

    // The signed-in profile is still the account that owns the lead/credits.
    const { data: callerProfile } = await db
        .from('profiles')
        .select('id, email, business_info')
        .eq('id', profileId)
        .maybeSingle()

    const candidates: Array<{ authId: string; authToken: string; number: string; source: string }> = []

    // 1. explicit env override
    if (process.env.TTS_FLASH_VOBIZ_AUTH_ID && process.env.TTS_FLASH_VOBIZ_AUTH_TOKEN) {
        candidates.push({
            authId: process.env.TTS_FLASH_VOBIZ_AUTH_ID,
            authToken: process.env.TTS_FLASH_VOBIZ_AUTH_TOKEN,
            number: process.env.TTS_FLASH_CALLER_NUMBER || '',
            source: 'env TTS_FLASH_VOBIZ_AUTH_ID',
        })
    }

    // 2. the designated voice account (Blue Square Infra by default)
    const voiceAccountEmail = process.env.TTS_FLASH_VOICE_ACCOUNT_EMAIL || 'infobluesquareinfra@gmail.com'
    const { data: voiceAccount } = await db
        .from('profiles')
        .select('email, business_name, business_info')
        .eq('email', voiceAccountEmail)
        .maybeSingle()

    if (voiceAccount) {
        const bi = parseBizInfo(voiceAccount.business_info)
        const authId = bi.voice_vobiz_auth_id || bi.kyc_data?.vobizSubAuthId || ''
        const authToken = bi.voice_vobiz_auth_token || ''
        if (authId && authToken) {
            candidates.push({
                authId,
                authToken,
                number: normalize(bi.voice_vobiz_number || bi.claimed_vobiz_number || ''),
                source: `${voiceAccountEmail}${voiceAccount.business_name ? ` (${voiceAccount.business_name})` : ''}`,
            })
        }
    }

    // 3. the signed-in profile itself
    if (callerProfile) {
        const bi = parseBizInfo(callerProfile.business_info)
        const authId = bi.voice_vobiz_auth_id || bi.kyc_data?.vobizSubAuthId || process.env.VOBIZ_AUTH_ID || ''
        const authToken = bi.voice_vobiz_auth_token || process.env.VOBIZ_AUTH_TOKEN || ''
        if (authId && authToken) {
            candidates.push({
                authId,
                authToken,
                number: normalize(bi.voice_vobiz_number || bi.claimed_vobiz_number || ''),
                source: `${callerProfile.email} (own account)`,
            })
        }
    }

    if (!candidates.length) {
        return { ok: false, error: 'No Vobiz credentials found on any account — cannot place a call.' }
    }

    let lastOwned: string[] = []
    for (const candidate of candidates) {
        const owned = await listOwnedNumbers(candidate.authId, candidate.authToken)
        lastOwned = owned
        if (!owned.length) continue

        // Prefer the intended number, then any voice-capable number the account
        // actually owns. Never present a DID the carrier will reject.
        const wanted = candidate.number
        const chosen = wanted && owned.includes(wanted) ? wanted : owned[0]

        return {
            ok: true,
            identity: {
                authId: candidate.authId,
                authToken: candidate.authToken,
                callerNumber: chosen,
                source: `${candidate.source}${wanted && chosen !== wanted ? ` — ${wanted} not owned, using ${chosen}` : ''}`,
                ownedNumbers: owned,
            },
        }
    }

    return {
        ok: false,
        error: 'None of the configured Vobiz accounts own a voice-capable number, so the carrier would reject the call.',
        ownedNumbers: lastOwned,
    }
}
