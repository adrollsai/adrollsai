import { warmupVoiceBridge } from '@/utils/voice-helper'
import { hasEnoughCredits } from '@/utils/credits'
import { VOBIZ_NUMBER_CATALOG, VobizAvailableNumber } from '@/utils/vobiz-catalog'
import { computeValidCallingSlot } from '@/utils/calling-window'
import { isIndianPhoneNumber } from '@/utils/phone-validation'
import { resolveAppUrl, isAbsoluteHttpsUrl, describeUrlProblem } from '@/utils/app-url'

export { VOBIZ_NUMBER_CATALOG, type VobizAvailableNumber }

/**
 * Pick a caller ID from the shared DID pool, spread deterministically by `seed`.
 *
 * PURE, so the distribution can be tested without placing a call. It is a hash rather than a shared
 * counter on purpose: a counter needs somewhere to live, breaks across serverless instances and can
 * drift, whereas a hash of the lead id spreads calls the same way every time and is stable for a given
 * lead (so a retried call does not silently change the number the person just missed a call from).
 *
 * Returns null for an empty pool, so the caller can fall back rather than dial from ''.
 */
export function pickRotatedDid(pool: readonly string[], seed: string): string | null {
  const usable = (pool || []).map((n) => String(n || '').trim()).filter(Boolean)
  if (usable.length === 0) return null
  let hash = 0
  const text = String(seed || '')
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return usable[hash % usable.length]
}

export interface VobizCallParams {
    leadId: string
    profileId: string
    toPhone: string
    campaignId?: string
    fromPhone?: string
    allowAfterHours?: boolean
    skipCreditCheck?: boolean
    voiceName?: string
    customAuthId?: string
    customAuthToken?: string
    /**
     * Relative answer-webhook path to use instead of the default Gemini Live
     * XML route. Used by the Gemini TTS-Flash pipeline demo, which answers on
     * /api/voice/vobiz/tts-flash-xml so the Live path stays untouched.
     */
    answerPath?: string
    /** Extra query params appended to the answer webhook (voice id, language, ...). */
    answerParams?: Record<string, string | undefined | null>
    /** Skip the Gemini Live session pre-warm (wrong pipeline for TTS-Flash calls). */
    skipBridgeWarmup?: boolean
}

export interface VobizCallResult {
    success: boolean
    callUuid?: string
    apiId?: string
    message?: string
    error?: string
    scheduled?: boolean
    scheduledTime?: Date
}

/**
 * Triggers an outbound call via Vobiz REST API.
 * Endpoint: POST https://api.vobiz.ai/api/v1/Account/{auth_id}/Call/
 */
export async function triggerVobizOutboundCall(
    supabaseAdmin: any,
    params: VobizCallParams
): Promise<VobizCallResult> {
    const { leadId, profileId, toPhone, campaignId, fromPhone, allowAfterHours } = params

    // 0a. Restrict calls strictly to Indian numbers (+91)
    if (!isIndianPhoneNumber(toPhone)) {
        console.warn(`[VOBIZ HELPER] Call to ${toPhone} BLOCKED: Non-Indian phone number. Vobiz only supports Indian (+91) destinations.`)
        if (leadId) {
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'skipped_international' })
                .eq('id', leadId)

            try {
                await supabaseAdmin.from('lead_history').insert({
                    lead_id: leadId,
                    action_type: 'REMARK',
                    description: `🚫 Outbound AI call blocked: Non-Indian phone number (${toPhone}). Telephony only supports Indian (+91) numbers.`
                })
            } catch (hErr) {}
        }
        return {
            success: false,
            error: 'NON_INDIAN_NUMBER: Telephony provider only supports Indian (+91) phone numbers.'
        }
    }

    // 0. Strict Calling Hours Gatekeeper: 9:00 AM - 7:00 PM IST (09:00 - 19:00)
    // Under NO circumstances may outbound calls dial between 7:00 PM and 9:00 AM IST.
    const { isWithinWindow, scheduledTime } = computeValidCallingSlot(new Date(), 'Asia/Kolkata', !!allowAfterHours)
    if (!isWithinWindow) {
        console.warn(`[VOBIZ HELPER] Call to ${toPhone} BLOCKED: Outside allowed calling window (9:00 AM - 7:00 PM IST). Rescheduled for ${scheduledTime.toISOString()}.`)
        if (leadId) {
            await supabaseAdmin
                .from('leads')
                .update({
                    voice_call_status: 'scheduled_callback',
                    voice_call_scheduled_at: scheduledTime.toISOString()
                })
                .eq('id', leadId)

            try {
                await supabaseAdmin.from('lead_history').insert({
                    lead_id: leadId,
                    action_type: 'REMARK',
                    description: `🕒 Outbound call blocked: Outside allowed calling window (9:00 AM - 7:00 PM IST). Rescheduled for ${scheduledTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.`
                })
            } catch (hErr) {
                console.error('[VOBIZ HELPER] Error writing history entry:', hErr)
            }
        }
        return {
            success: false,
            scheduled: true,
            scheduledTime,
            error: 'Calling is strictly prohibited outside 9:00 AM - 7:00 PM IST. Call scheduled for next business window (9:00 AM IST).'
        }
    }

    // 1. Fetch user profile for subscription, credits, and concurrency limits
    const { data: profile, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .single()

    if (profErr || !profile) {
        return { success: false, error: 'User profile not found.' }
    }

    // 2. Subscription Check
    const subscriptionStatus = profile.subscription_status?.toLowerCase() || ''
    const subscriptionValidUntil = profile.subscription_valid_until
    const userEmail = profile.email?.toLowerCase() || ''
    const whitelistedEmails = [
        'rchopra489@gmail.com',
        'infobluesquareinfra@gmail.com',
        'khushiramrealtor@gmail.com',
        'rajivkumaraggarwal81@gmail.com',
        'gnrhomes97@gmail.com',
        'alpinenesthomes01@gmail.com',
        'umangassociates5@gmail.com'
    ]
    const isWhitelisted = whitelistedEmails.includes(userEmail)

    const isSubscriptionExpired = subscriptionValidUntil && new Date(subscriptionValidUntil) < new Date()
    const isPaid = (subscriptionStatus === 'active' || subscriptionStatus === 'trialing' || subscriptionStatus === 'pro' || subscriptionStatus === 'enterprise') && !isSubscriptionExpired

    if (!isPaid && !isWhitelisted) {
        return { success: false, error: 'SUBSCRIPTION_EXPIRED' }
    }

    // 3. Concurrency check (default: 3 concurrent calls per account)
    const maxConcurrent = profile.voice_concurrency_limit || 3
    const { data: activeLeads } = await supabaseAdmin
        .from('leads')
        .select('id, voice_call_scheduled_at, created_at')
        .eq('user_id', profileId)
        .eq('voice_call_status', 'calling')

    const nowTs = Date.now()
    const activeCalls: any[] = []

    for (const c of (activeLeads || [])) {
        const rawTs = c.voice_call_scheduled_at || c.created_at
        const updatedAtTime = rawTs ? new Date(rawTs).getTime() : 0
        const elapsed = nowTs - updatedAtTime
        // Auto-recover calls stuck in calling for >= 7 minutes.
        // A row with NO usable timestamp can never become "old" by comparison,
        // so it used to sit in 'calling' forever and permanently occupy a
        // concurrency slot. Treat a missing timestamp as stale as well.
        if (!updatedAtTime || Number.isNaN(updatedAtTime) || elapsed >= 7 * 60 * 1000) {
            console.warn(`[VOBIZ HELPER] Auto-recovering stale call stuck for lead ${c.id}`)
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'no_answer' })
                .eq('id', c.id)
        } else {
            activeCalls.push(c)
        }
    }

    if (activeCalls.length >= maxConcurrent && !activeCalls.some(c => c.id === leadId)) {
        console.warn(`[VOBIZ HELPER] Max concurrency limit (${maxConcurrent}) reached for user ${profileId}. Queuing call for lead ${leadId}.`)
        await supabaseAdmin
            .from('leads')
            .update({
                voice_call_status: 'queued',
                voice_call_scheduled_at: new Date().toISOString()
            })
            .eq('id', leadId)

        return {
            success: true,
            scheduled: true,
            scheduledTime: new Date(),
            message: `Call queued (Channel busy: ${activeCalls.length}/${maxConcurrent} active)`
        }
    }

    // 4. Nobo Credits balance check (needs at least 40 credits for 1 minute call)
    if (!params.skipCreditCheck) {
        const hasCredits = await hasEnoughCredits(supabaseAdmin, profileId, 40)
        if (!hasCredits) {
            console.warn(`[VOBIZ HELPER] Outbound call aborted for lead ${leadId}: Insufficient credits for user ${profileId}`)
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'failed' })
                .eq('id', leadId)

            try {
                await supabaseAdmin.from('lead_history').insert({
                    lead_id: leadId,
                    action_type: 'REMARK',
                    description: `❌ Outbound call aborted: Insufficient Nobo Credits balance. Please recharge AI credits to make calls.`
                })
            } catch (hErr) {
                console.error('[VOBIZ HELPER] Error writing history entry:', hErr)
            }
            return { success: false, error: 'Insufficient credits. Please recharge your AI credits.' }
        }
    }

    // 5. Auth Credentials & Caller ID
    const bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : (profile.business_info || {})
    const authId = params.customAuthId || profile.voice_vobiz_auth_id || bi.voice_vobiz_auth_id || bi.kyc_data?.vobizSubAuthId || process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    const authToken = params.customAuthToken || profile.voice_vobiz_auth_token || bi.voice_vobiz_auth_token || process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'
    
    // Strictly require an assigned number for the account. NEVER fall back to unverified test numbers.
    const isNobogentMaster = profile.email === 'rchopra489@gmail.com' || profile.role === 'super_admin'
    const masterNumber = process.env.VOBIZ_TEST_NUMBER || null

    // DID ROTATION. All the numbers on the Vobiz account are one shared pool and no DID belongs to any
    // one tenant, so a call is placed from a number rotated across that pool rather than from a number
    // "owned" by the caller. That is what makes the outbound traffic look like one marketing department
    // with many lines instead of the same line every time.
    //
    // Order: an explicit caller-supplied number wins (an owner testing a specific line), then the shared
    // pool, and only then a per-tenant number as a last resort so an account with a claimed DID and an
    // empty pool still works. The seed is the lead id, so the choice is spread across the pool and
    // stable for a given lead — no shared counter, and nothing to get out of sync across instances.
    const sharedPool = VOBIZ_NUMBER_CATALOG.map((n) => n.phoneNumber).filter(Boolean)
    const rotatedNumber = pickRotatedDid(sharedPool, String(leadId || profileId || ''))
    const assignedNumber = fromPhone 
        || rotatedNumber
        || profile.voice_vobiz_number 
        || bi.claimed_vobiz_number 
        || bi.voice_vobiz_number 
        || (profile.voice_twilio_number?.startsWith('+91') && profile.voice_twilio_number !== '+911171366938' ? profile.voice_twilio_number : null)
        || (isNobogentMaster ? masterNumber : null)

    if (!assignedNumber) {
        console.warn(`[VOBIZ HELPER] Call aborted for lead ${leadId}: Account ${profile.email} (${profileId}) has NO assigned phone number.`);
        await supabaseAdmin
            .from('leads')
            .update({ voice_call_status: 'failed' })
            .eq('id', leadId);

        try {
            await supabaseAdmin.from('lead_history').insert({
                lead_id: leadId,
                action_type: 'REMARK',
                description: `❌ Outbound call aborted: No dedicated phone number is assigned to your account. Please assign a virtual number in settings to enable calling.`
            });
        } catch (e) {}

        return {
            success: false,
            error: 'NO_PHONE_NUMBER_ASSIGNED: Outbound calls cannot proceed because no dedicated phone number is assigned to this account.'
        };
    }

    let callerId = assignedNumber;

    let appUrl = resolveAppUrl()

    // Format destination number to E.164 (+91 standard)
    let cleanPhone = toPhone.replace(/\D/g, '')
    if (!cleanPhone.startsWith('+')) {
        if (cleanPhone.length === 10) {
            cleanPhone = '+91' + cleanPhone
        } else {
            cleanPhone = '+' + cleanPhone
        }
    }

    // Warm up voice bridge & pre-warm Gemini session
    if (!params.skipBridgeWarmup) {
        await warmupVoiceBridge(leadId, profileId, campaignId, params.voiceName)
    }

    // Update lead voice call status in DB
    try {
        await supabaseAdmin
            .from('leads')
            .update({
                voice_call_status: 'calling',
                voice_call_summary: null,
                voice_call_transcript: null,
                voice_recording_url: null
            })
            .eq('id', leadId)
    } catch (dbErr) {
        console.warn('[VOBIZ HELPER] Failed to update lead status:', dbErr)
    }

    const defaultAnswerPath = `/api/voice/vobiz/xml?leadId=${encodeURIComponent(leadId)}&profileId=${encodeURIComponent(profileId)}${campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ''}${params.voiceName ? `&voiceName=${encodeURIComponent(params.voiceName)}` : ''}&vobizAuthId=${encodeURIComponent(authId)}&vobizAuthToken=${encodeURIComponent(authToken)}`
    const extraParams = Object.entries(params.answerParams || {})
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`)
        .join('')
    // answerPath may be absolute (e.g. the voice bridge serving its own answer
    // webhook) — in that case it is used verbatim instead of being appended to
    // the app URL.
    const answerUrl = params.answerPath
        ? (/^https?:\/\//i.test(params.answerPath)
            ? `${params.answerPath}${params.answerPath.includes('?') ? '&' : '?'}leadId=${encodeURIComponent(leadId)}&profileId=${encodeURIComponent(profileId)}${campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ''}&vobizAuthId=${encodeURIComponent(authId)}&vobizAuthToken=${encodeURIComponent(authToken)}${extraParams}`
            : `${appUrl}${params.answerPath}?leadId=${encodeURIComponent(leadId)}&profileId=${encodeURIComponent(profileId)}${campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ''}&vobizAuthId=${encodeURIComponent(authId)}&vobizAuthToken=${encodeURIComponent(authToken)}${extraParams}`)
        : `${appUrl}${defaultAnswerPath}`
    const hangupUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${encodeURIComponent(leadId)}&vobizAuthId=${encodeURIComponent(authId)}&vobizAuthToken=${encodeURIComponent(authToken)}`

    // Fail loudly here rather than letting Vobiz answer with its deliberately
    // vague "answer_url parameter is not valid". That response used to surface
    // in the demo as a generic failure while the real cause - a corrupt env
    // value such as a BOM-prefixed NEXT_PUBLIC_APP_URL - stayed invisible.
    for (const [label, candidate] of [['answer_url', answerUrl], ['hangup_url', hangupUrl]] as const) {
        if (!isAbsoluteHttpsUrl(candidate)) {
            const problem = describeUrlProblem(candidate)
            console.error(`[VOBIZ HELPER] Refusing to dial lead ${leadId}: ${label} is unusable (${problem}). Value starts with ${JSON.stringify(candidate.slice(0, 12))}`)
            if (leadId) {
                await supabaseAdmin
                    .from('leads')
                    .update({ voice_call_status: 'failed' })
                    .eq('id', leadId)
                try {
                    await supabaseAdmin.from('lead_history').insert({
                        lead_id: leadId,
                        action_type: 'REMARK',
                        description: `❌ Outbound call aborted: ${label} is not a valid https URL (${problem}). Check NEXT_PUBLIC_APP_URL for invisible characters.`
                    })
                } catch (hErr) {}
            }
            return {
                success: false,
                error: `TELEPHONY_URL_INVALID: ${label} is not a valid https URL (${problem}).`
            }
        }
    }

    const requestPayload = {
        from: callerId,
        to: cleanPhone,
        answer_url: answerUrl,
        answer_method: 'POST',
        hangup_url: hangupUrl,
        hangup_method: 'POST'
    }

    console.log(`[VOBIZ HELPER] Initiating outbound call to ${cleanPhone} from ${callerId} (User: ${profileId})...`)

    try {
        const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`
        const res = await fetch(vobizUrl, {
            method: 'POST',
            headers: {
                'X-Auth-ID': authId,
                'X-Auth-Token': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestPayload)
        })

        const data = await res.json()

        if (!res.ok) {
            console.error('[VOBIZ HELPER] Call creation failed:', data)
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'failed' })
                .eq('id', leadId)

            return {
                success: false,
                error: data.error || data.message || `HTTP ${res.status}: Failed to trigger Vobiz call.`
            }
        }

        const callUuid = data.request_uuid || data.call_uuid || data.api_id
        console.log(`[VOBIZ HELPER] Outbound call created successfully! UUID: ${callUuid}`)

        if (callUuid) {
            try {
                await supabaseAdmin
                    .from('leads')
                    .update({ voice_call_id: callUuid })
                    .eq('id', leadId)
            } catch (uErr) {
                console.warn('[VOBIZ HELPER] Could not update lead voice_call_id:', uErr)
            }
        }

        return {
            success: true,
            callUuid,
            apiId: data.api_id,
            message: data.message || 'Call initiated successfully via Vobiz'
        }
    } catch (err: any) {
        console.error('[VOBIZ HELPER] Network error initiating Vobiz call:', err)
        return {
            success: false,
            error: err.message || 'Network error triggering Vobiz call.'
        }
    }
}

/**
 * Fetches the recording URL for a specific Vobiz call UUID from the Recording API.
 */
export async function fetchVobizCallRecording(
    callUuid: string,
    credentialsOrAuthId?: { authId?: string; authToken?: string } | string,
    rawAuthToken?: string
): Promise<string | null> {
    if (!callUuid) return null
    let authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    let authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'

    if (typeof credentialsOrAuthId === 'string') {
        authId = credentialsOrAuthId || authId
        authToken = rawAuthToken || authToken
    } else if (credentialsOrAuthId && typeof credentialsOrAuthId === 'object') {
        authId = credentialsOrAuthId.authId || authId
        authToken = credentialsOrAuthId.authToken || authToken
    }

    try {
        const url = `https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?call_uuid=${callUuid}&limit=1`
        const res = await fetch(url, {
            headers: {
                'X-Auth-ID': authId,
                'X-Auth-Token': authToken
            }
        })
        if (res.ok) {
            const data = await res.json().catch(() => ({}))
            const recording = data.objects?.[0] || data.recordings?.[0] || data
            return recording?.recording_url || recording?.url || recording?.mp3_url || null
        }
    } catch (err) {
        console.warn('[VOBIZ HELPER] Error fetching call recording:', err)
    }
    return null
}

/**
 * Terminates an active call on Vobiz via REST API.
 * Endpoint: DELETE https://api.vobiz.ai/api/v1/Account/{auth_id}/Call/{call_uuid}/
 */
export async function terminateVobizCall(callUuid: string): Promise<boolean> {
    const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'

    try {
        const url = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/`
        const res = await fetch(url, {
            method: 'DELETE',
            headers: {
                'X-Auth-ID': authId,
                'X-Auth-Token': authToken
            }
        })
        return res.ok
    } catch (err) {
        console.error('[VOBIZ HELPER] Error terminating call:', err)
        return false
    }
}

/**
 * Returns available Vobiz numbers for purchase/assignment.
 */
export function getAvailableVobizNumbers(): VobizAvailableNumber[] {
    return VOBIZ_NUMBER_CATALOG
}

/**
 * Provisions a customer sub-account under the master partner account on Vobiz.
 * Endpoint: POST https://api.vobiz.ai/api/v1/accounts/{auth_id}/sub-accounts/
 * Uses HTTP Basic Authentication (VOBIZ_AUTH_ID : VOBIZ_AUTH_TOKEN)
 */
export async function createVobizSubAccount(params: {
    name: string
    email: string
    phone?: string
    description?: string
    kycMode?: 'personal_use' | 'customer_use'
    entityType?: 'individual' | 'business'
    pan?: string
    gstin?: string
}): Promise<{ success: boolean; subAuthId?: string; subAuthToken?: string; subAccount?: any; error?: string }> {
    const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'
    const basicAuth = Buffer.from(`${authId}:${authToken}`).toString('base64')

    const kycMode = params.kycMode || 'customer_use'
    const payload: any = {
        name: params.name,
        email: params.email,
        phone: params.phone || '',
        description: params.description || `Sub-account for ${params.name}`,
        kyc_mode: kycMode,
        business_type: params.entityType === 'business' ? 'private_limited' : 'individual'
    }

    if (params.pan) payload.pan = params.pan
    if (params.gstin) payload.gstin = params.gstin

    const url = `https://api.vobiz.ai/api/v1/accounts/${authId}/sub-accounts/`

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })

        const data = await res.json().catch(() => ({}))

        if (res.ok || res.status === 201) {
            const sub = data.sub_account || data
            const subAuthId = sub.auth_id || sub.id
            const subAuthToken = sub.auth_token || sub.token
            console.log(`[VOBIZ SUBACCOUNT] Successfully created subaccount under ${authId}:`, subAuthId)
            return {
                success: true,
                subAuthId,
                subAuthToken,
                subAccount: sub
            }
        }

        // If email already in use (409 Conflict), fetch the existing subaccount details
        if (res.status === 409) {
            console.log(`[VOBIZ SUBACCOUNT] Subaccount ${params.email} already exists on Vobiz. Retrieving...`)
            const listRes = await fetch(url, {
                headers: {
                    'Authorization': `Basic ${basicAuth}`,
                    'Content-Type': 'application/json'
                }
            })
            const listData = await listRes.json().catch(() => ({}))
            const subAccounts = listData.sub_accounts || []
            const matching = subAccounts.find((s: any) => s.email?.toLowerCase() === params.email.toLowerCase())
            if (matching) {
                console.log(`[VOBIZ SUBACCOUNT] Found existing subaccount on Vobiz:`, matching.auth_id)
                return {
                    success: true,
                    subAuthId: matching.auth_id || matching.id,
                    subAuthToken: matching.auth_token || matching.token,
                    subAccount: matching
                }
            }
        }

        console.warn(`[VOBIZ SUBACCOUNT] Creation error from Vobiz:`, data)
        return {
            success: false,
            error: data.message || data.error || `HTTP ${res.status}: Failed to create Vobiz subaccount.`
        }
    } catch (err: any) {
        console.error(`[VOBIZ SUBACCOUNT] Network error:`, err.message)
        return {
            success: false,
            error: err.message || 'Unable to connect to Vobiz subaccount API.'
        }
    }
}

/**
 * Retrieves a sub-account by email, auth_id, or sub-account ID from Vobiz to check current real-time status.
 */
export async function getVobizSubAccount(identifier: string): Promise<any | null> {
    if (!identifier) return null
    const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'
    const basicAuth = Buffer.from(`${authId}:${authToken}`).toString('base64')
    const url = `https://api.vobiz.ai/api/v1/accounts/${authId}/sub-accounts/`

    try {
        const res = await fetch(url, {
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/json'
            }
        })
        if (!res.ok) return null
        const data = await res.json().catch(() => ({}))
        const subAccounts = data.sub_accounts || []
        const clean = identifier.toLowerCase().trim()
        return subAccounts.find((s: any) => 
            s.email?.toLowerCase() === clean || 
            s.auth_id?.toLowerCase() === clean ||
            String(s.id) === clean
        ) || null
    } catch (err: any) {
        console.warn('[VOBIZ HELPER] Error fetching subaccount status:', err.message)
        return null
    }
}
/**
 * Unassigns a virtual number from a Vobiz sub-account and resets carrier routing.
 */
export async function releaseVobizNumber(phoneNumber: string, subAccountAuthId?: string): Promise<boolean> {
    try {
        if (!phoneNumber) return false;
        const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
        const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';

        let cleanNumber = phoneNumber.replace(/\D/g, '');
        if (!cleanNumber.startsWith('+')) {
            cleanNumber = cleanNumber.startsWith('91') ? ('+' + cleanNumber) : ('+91' + cleanNumber);
        }

        if (subAccountAuthId) {
            console.log(`[VOBIZ HELPER] Unassigning number ${cleanNumber} from subaccount ${subAccountAuthId}...`);
            const res = await fetch(
                `https://api.vobiz.ai/api/v1/account/${authId}/numbers/${encodeURIComponent(cleanNumber)}/assign-subaccount`,
                {
                    method: 'DELETE',
                    headers: {
                        'X-Auth-ID': authId,
                        'X-Auth-Token': authToken,
                        'Content-Type': 'application/json'
                    }
                }
            ).catch(err => {
                console.warn('[VOBIZ HELPER] Error unassigning number:', err.message);
                return null;
            });
            if (res && !res.ok) {
                console.warn(`[VOBIZ HELPER] Vobiz unassign response status: ${res.status}`);
            }
        }

        console.log(`[VOBIZ HELPER] Number ${cleanNumber} unassigned and released successfully.`);
        return true;
    } catch (err: any) {
        console.error('[VOBIZ HELPER] Error releasing Vobiz number:', err.message);
        return false;
    }
}
