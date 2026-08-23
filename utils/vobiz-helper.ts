import { warmupVoiceBridge } from '@/utils/voice-helper'
import { hasEnoughCredits } from '@/utils/credits'
import { VOBIZ_NUMBER_CATALOG, VobizAvailableNumber } from '@/utils/vobiz-catalog'

export { VOBIZ_NUMBER_CATALOG, type VobizAvailableNumber }

export interface VobizCallParams {
    leadId: string
    profileId: string
    toPhone: string
    campaignId?: string
    fromPhone?: string
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
    const { leadId, profileId, toPhone, campaignId, fromPhone } = params

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
    const whitelistedEmails = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com']
    const isWhitelisted = whitelistedEmails.includes(userEmail)

    const isSubscriptionExpired = subscriptionValidUntil && new Date(subscriptionValidUntil) < new Date()
    const isPaid = (subscriptionStatus === 'active' || subscriptionStatus === 'trialing' || subscriptionStatus === 'pro') && !isSubscriptionExpired

    if (!isPaid && !isWhitelisted) {
        return { success: false, error: 'SUBSCRIPTION_EXPIRED' }
    }

    // 3. Concurrency check (default: 1 concurrent call per account, unless upgraded)
    const maxConcurrent = profile.voice_concurrency_limit || 1
    const { data: activeLeads } = await supabaseAdmin
        .from('leads')
        .select('id, last_called_at, voice_call_scheduled_at, created_at')
        .eq('user_id', profileId)
        .eq('voice_call_status', 'calling')

    const nowTs = Date.now()
    const activeCalls: any[] = []

    for (const c of (activeLeads || [])) {
        const updatedAtTime = new Date(c.last_called_at || c.voice_call_scheduled_at || c.created_at || 0).getTime()
        const elapsed = nowTs - updatedAtTime
        // Auto-recover calls stuck in calling for >= 7 minutes
        if (updatedAtTime > 0 && elapsed >= 7 * 60 * 1000) {
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

    // 5. Auth Credentials & Caller ID
    const authId = profile.voice_vobiz_auth_id || process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    const authToken = profile.voice_vobiz_auth_token || process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'
    
    // Priority for caller ID: passed fromPhone -> profile.voice_vobiz_number -> profile.voice_twilio_number -> env.VOBIZ_TEST_NUMBER -> default
    let callerId = fromPhone || profile.voice_vobiz_number || profile.voice_twilio_number || process.env.VOBIZ_TEST_NUMBER || '+911171366938'

    let appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://local.nobogent.com'
    if (appUrl.includes('localhost') || appUrl.includes('127.0.0.1')) {
        appUrl = 'https://local.nobogent.com'
    }

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
    await warmupVoiceBridge(leadId, profileId, campaignId)

    // Update lead voice call status in DB
    try {
        await supabaseAdmin
            .from('leads')
            .update({
                voice_call_status: 'calling',
                voice_call_summary: null,
                voice_call_transcript: null,
                voice_recording_url: null,
                last_called_at: new Date().toISOString()
            })
            .eq('id', leadId)
    } catch (dbErr) {
        console.warn('[VOBIZ HELPER] Failed to update lead status:', dbErr)
    }

    const answerUrl = `${appUrl}/api/voice/vobiz/xml?leadId=${leadId}&profileId=${profileId}${campaignId ? `&campaignId=${campaignId}` : ''}`
    const hangupUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${leadId}`

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
export async function fetchVobizCallRecording(callUuid: string): Promise<string | null> {
    if (!callUuid) return null
    const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'

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
 */
export async function createVobizSubAccount(params: {
    name: string
    email: string
    entityType: 'individual' | 'business'
}): Promise<{ success: boolean; subAuthId?: string; subAuthToken?: string; error?: string }> {
    const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'

    try {
        const url = `https://api.vobiz.ai/api/v1/accounts/${authId}/sub-accounts/`
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'X-Auth-ID': authId,
                'X-Auth-Token': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: params.name,
                email: params.email,
                kyc_mode: 'customer_use',
                business_type: params.entityType === 'business' ? 'private_limited' : 'individual'
            })
        })

        const data = await res.json().catch(() => ({}))
        if (res.ok) {
            console.log(`[VOBIZ SUBACCOUNT] Successfully created sub-account for ${params.email}:`, data.auth_id || data.id)
            return {
                success: true,
                subAuthId: data.auth_id || data.sub_auth_id || data.id,
                subAuthToken: data.auth_token || data.sub_auth_token || data.token
            }
        } else {
            console.warn('[VOBIZ SUBACCOUNT] Sub-account provisioning response:', data)
            return {
                success: false,
                error: data.error || data.message || `HTTP ${res.status}`
            }
        }
    } catch (err: any) {
        console.warn('[VOBIZ SUBACCOUNT] Error creating sub-account:', err.message)
        return { success: false, error: err.message }
    }
}
