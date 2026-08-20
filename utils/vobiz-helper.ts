import { warmupVoiceBridge } from '@/utils/voice-helper'

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

    const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
    const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'
    const callerId = fromPhone || process.env.VOBIZ_TEST_NUMBER || '+911171366938'

    let appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
    if (appUrl.includes('localhost') || appUrl.includes('local.nobogent.com')) {
        appUrl = 'https://app.nobogent.com'
    }

    // Format destination number to E.164
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

    console.log(`[VOBIZ HELPER] Initiating outbound call to ${cleanPhone} from ${callerId}...`)

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

        console.log(`[VOBIZ HELPER] Outbound call created successfully! Call UUID / API ID:`, data.request_uuid || data.api_id || data.call_uuid)

        // Save call UUID if available
        const callUuid = data.request_uuid || data.call_uuid || data.api_id
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
