import { warmupVoiceBridge } from '@/utils/voice-helper'
import { hasEnoughCredits } from '@/utils/credits'
import { VOBIZ_NUMBER_CATALOG, VobizAvailableNumber } from '@/utils/vobiz-catalog'
import { computeValidCallingSlot, describeCallingWindow, type CallingWindow } from '@/utils/calling-window'
import { isIndianPhoneNumber } from '@/utils/phone-validation'
import { resolveAppUrl, isAbsoluteHttpsUrl, describeUrlProblem } from '@/utils/app-url'
import { loadVoiceChannels, pickChannel, describeCapacity } from '@/lib/automation/voice-channels'

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

/** The master Vobiz account, whose credentials can dial from any DID the account owns. */
const MASTER_AUTH_ID = () => String(process.env.VOBIZ_AUTH_ID || '').replace(/"/g, '').trim()
const MASTER_AUTH_TOKEN = () => String(process.env.VOBIZ_AUTH_TOKEN || '').replace(/"/g, '').trim()

function basicAuthHeader(authId: string, authToken: string): string {
  return `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`
}

/**
 * The DIDs this Vobiz account actually owns, newest pool first — the real rotation pool.
 *
 * WHY THIS EXISTS
 * Rotation used to be seeded from `VOBIZ_NUMBER_CATALOG`, which is the catalogue of numbers you can
 * BUY, not the ones you own. Production duly picked a number nobody owned and Vobiz answered
 * "The from number 911171366938 is not owned by this account", so not one call could be placed.
 *
 * Verified against the live API instead of guessed: the account owns six 79-series DIDs, three of
 * them unassigned and three attached to sub-accounts, and the MASTER credentials can place a call
 * from every one of them — including the sub-account ones (measured: 201 "call queued" from
 * +917965480539 / SA_9EVCEZKC and +917965853573 / SA_5USUA60B using master auth). So a DID being
 * "owned" by another sub-account does not stand in the way of rotating across it, which is exactly
 * what was asked for: every number on the account is one shared pool.
 *
 * Cached for ten minutes because this sits in front of a dial: the pool changes when someone buys or
 * releases a number, not between calls, and a network round trip per dial would add latency to the
 * one thing that must feel instant.
 */
const OWNED_DID_TTL_MS = 10 * 60_000
let ownedDidCache: { at: number; numbers: string[] } | null = null

export async function getOwnedVobizDids(
  authId: string = MASTER_AUTH_ID(),
  authToken: string = MASTER_AUTH_TOKEN(),
  options: { forceRefresh?: boolean } = {}
): Promise<string[]> {
  if (!authId || !authToken) return []
  if (!options.forceRefresh && ownedDidCache && Date.now() - ownedDidCache.at < OWNED_DID_TTL_MS) {
    return ownedDidCache.numbers
  }

  try {
    const res = await fetch(`https://api.vobiz.ai/api/v1/account/${authId}/numbers`, {
      headers: { Authorization: basicAuthHeader(authId, authToken) },
    })
    if (!res.ok) {
      console.warn(`[VOBIZ HELPER] Could not list owned DIDs (HTTP ${res.status}); keeping the previous pool.`)
      return ownedDidCache?.numbers || []
    }
    const body = await res.json()
    const numbers = (body.items || [])
      .filter((n: any) => n?.status === 'active' && n?.voice_enabled !== false && n?.e164)
      .map((n: any) => String(n.e164))
      .filter(Boolean)
      // Sorted so the rotation is stable regardless of the order the API happens to return.
      .sort()
    if (numbers.length) {
      ownedDidCache = { at: Date.now(), numbers }
      console.log(`[VOBIZ HELPER] Rotation pool: ${numbers.length} owned DID(s) — ${numbers.join(', ')}`)
    }
    return numbers
  } catch (err: any) {
    console.warn('[VOBIZ HELPER] Owned-DID lookup failed, keeping the previous pool:', err?.message)
    return ownedDidCache?.numbers || []
  }
}

/** Forget the cached DID pool (used by tests and by an operator after buying a number). */
export function clearOwnedDidCache(): void {
  ownedDidCache = null
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

    // 0. Calling Hours Gatekeeper. The default window is 09:00-19:00 IST, but a tenant may open
    //    its own day later (a coaching institute taking evening enquiries runs to 20:00) via
    //    `business_info.calling_hours = { start, end }` in 24-hour local time. The window used is
    //    reported in the blocked-call note so nobody has to guess which rule applied.
    let callingWindow: CallingWindow = {}
    try {
        const { data: windowRow } = await supabaseAdmin
            .from('profiles')
            .select('business_info')
            .eq('id', profileId)
            .maybeSingle()
        const wbi = typeof windowRow?.business_info === 'string'
            ? JSON.parse(windowRow.business_info)
            : (windowRow?.business_info || {})
        const configured = wbi?.calling_hours
        if (configured && (configured.start != null || configured.end != null)) {
            callingWindow = { startHour: Number(configured.start), endHour: Number(configured.end) }
        }
    } catch (windowErr: any) {
        console.warn('[VOBIZ HELPER] Could not read calling_hours; using the default window:', windowErr?.message)
    }

    const { isWithinWindow, scheduledTime } = computeValidCallingSlot(new Date(), 'Asia/Kolkata', !!allowAfterHours, callingWindow)
    if (!isWithinWindow) {
        const windowLabel = describeCallingWindow(callingWindow)
        console.warn(`[VOBIZ HELPER] Call to ${toPhone} BLOCKED: Outside this account's calling window (${windowLabel}). Rescheduled for ${scheduledTime.toISOString()}.`)
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
                    description: `🕒 Outbound call blocked: Outside this account's calling window (${windowLabel}). Rescheduled for ${scheduledTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.`
                })
            } catch (hErr) {
                console.error('[VOBIZ HELPER] Error writing history entry:', hErr)
            }
        }
        return {
            success: false,
            scheduled: true,
            scheduledTime,
            error: `Calling is strictly prohibited outside ${windowLabel}. Call scheduled for the next business window.`
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
    // uthId below may be overridden by the picked channel further down, so both come from one decision.
    const authId = params.customAuthId || profile.voice_vobiz_auth_id || bi.voice_vobiz_auth_id || bi.kyc_data?.vobizSubAuthId || process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    const authToken = params.customAuthToken || profile.voice_vobiz_auth_token || bi.voice_vobiz_auth_token || process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'
    
    // Strictly require an assigned number for the account. NEVER fall back to unverified test numbers.
    const isNobogentMaster = profile.email === 'rchopra489@gmail.com' || profile.role === 'super_admin'
    const masterNumber = process.env.VOBIZ_TEST_NUMBER || null

// CHANNELS FIRST. When the deployment (or the tenant) has configured explicit Vobiz channels, the call goes out
    // on one of THEM — the auth account and caller ID travel together, so billing and the number always agree, and
    // capacity is the sum of what we pay for. Rotation across the shared DID catalogue stays as the fallback for
    // accounts that have not been put on channels yet.
    const channelRegistry = loadVoiceChannels({
        profileNumber: profile.voice_vobiz_number,
        businessInfo: bi,
        concurrencyLimit: profile.voice_concurrency_limit,
    })
    const channel = channelRegistry.source === 'fallback'
        ? null
        : pickChannel(channelRegistry.channels, String(leadId || profileId || ''))
    if (channel) {
        console.log(`[VOBIZ HELPER] Dialling on ${channel.label} (auth ${channel.authId || 'default'}) — ${describeCapacity(channelRegistry.channels, channelRegistry.source)}`)
    }

    // DID ROTATION across every number the Vobiz account actually owns.
    //
    // The pool used to be VOBIZ_NUMBER_CATALOG — the catalogue of numbers you can BUY — so rotation
    // picked a number nobody owned and every dial failed with "not owned by this account". It now
    // comes from the live account inventory (getOwnedVobizDids), which is the only list that means
    // anything at dial time.
    //
    // Ownership by a sub-account does NOT exclude a number. Verified against the API: the master
    // credentials can place calls from every owned DID, including the ones attached to other
    // sub-accounts, so all of them rotate together as one shared pool — which is the behaviour asked
    // for. A per-tenant number is still honoured as a last resort so an account with a claimed DID
    // and an empty pool keeps working.
    //
    // The seed is the lead id, so the choice is spread across the pool and stable for a given lead —
    // no shared counter, and nothing to get out of sync across instances.
    const ownedDids = await getOwnedVobizDids(authId, authToken)
    const sharedPool = ownedDids.length ? ownedDids : VOBIZ_NUMBER_CATALOG.map((n) => n.phoneNumber).filter(Boolean)
    const rotatedNumber = pickRotatedDid(sharedPool, String(leadId || profileId || ''))
    const assignedNumber = channel?.number
        || fromPhone
        || rotatedNumber
        || profile.voice_vobiz_number 
        || bi.claimed_vobiz_number 
        || bi.voice_vobiz_number 
        || (profile.voice_twilio_number?.startsWith('+91') && profile.voice_twilio_number !== '+911171366938' ? profile.voice_twilio_number : null)
        || (isNobogentMaster ? masterNumber : null)

    // Which credentials may dial from the number we picked. The number and the account that authorises
    // it travel together: a rotated DID belongs to the master account, so it is dialled with master
    // credentials even when the tenant has its own Vobiz sub-account — a sub-account cannot place a
    // call from a number it does not hold. An explicit channel or a caller-supplied number keeps the
    // credentials it came with.
    const usingRotatedDid = !channel?.number && !fromPhone && rotatedNumber && assignedNumber === rotatedNumber
    const dialAuthOverride = usingRotatedDid
        ? { authId: MASTER_AUTH_ID() || authId, authToken: MASTER_AUTH_TOKEN() || authToken }
        : null

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

    const requestPayload: any = {
        from: callerId,
        to: cleanPhone,
        answer_url: answerUrl,
        answer_method: 'POST',
        hangup_url: hangupUrl,
        hangup_method: 'POST'
    }

    /**
     * Answering-machine detection.
     *
     * The voice bridge dispatches its greeting the moment the call connects, so on a
     * voicemail it always spoke first and then hung up - the prospect (or their inbox)
     * heard "Hi X ji..." before we could tell it was a machine. The bridge now also
     * detects a recorded greeting from the transcript, but by then speech has happened.
     *
     * Vobiz documents synchronous AMD as machine_detection=true|hangup
     * (https://www.vobiz.ai/docs/call/machine-detection).
     *
     * DEFAULT IS OFF, DELIBERATELY. Measured on this account: with 'hangup' the very
     * next 14 calls ended 13 no_answer / 0 completed, against a ~50% completion rate
     * immediately before. Vobiz's AMD is false-positiving on real Indian mobiles, and
     * hanging up on a live prospect costs a lead - far worse than leaving a short
     * greeting on a machine. The bridge now detects a recorded greeting from the
     * transcript and hangs up, which is the safer half of the fix.
     *
     * Opt in with VOBIZ_MACHINE_DETECTION=hangup once AMD is verified on this trunk.
     */
    const machineDetection = String(process.env.VOBIZ_MACHINE_DETECTION || 'off').toLowerCase().trim()
    if (machineDetection && machineDetection !== 'off' && machineDetection !== 'false') {
        requestPayload.machine_detection = machineDetection
    }

    console.log(`[VOBIZ HELPER] Initiating outbound call to ${cleanPhone} from ${callerId} (User: ${profileId})...`)

    try {
        // The number and the account that authorises it must never disagree: an explicit channel wins,
        // then a caller-supplied number keeps the credentials it came with, and a rotated DID is dialled
        // with master credentials because that is the account which holds it.
        const dialAuthId = dialAuthOverride?.authId || channel?.authId || authId
        const dialAuthToken = dialAuthOverride?.authToken || authToken
        if (dialAuthOverride) {
            console.log(`[VOBIZ HELPER] Rotated DID ${callerId} is authorised by the master account ${dialAuthId}`)
        }
    const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${dialAuthId}/Call/`
        const res = await fetch(vobizUrl, {
            method: 'POST',
            headers: {
                'X-Auth-ID': dialAuthId,
                'X-Auth-Token': dialAuthToken,
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
