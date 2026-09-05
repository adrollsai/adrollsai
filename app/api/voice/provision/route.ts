import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { VOBIZ_NUMBER_CATALOG } from '@/utils/vobiz-catalog'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        const impersonateId = url.searchParams.get('impersonate')

        let targetId = user.id
        if (impersonateId) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()
            if (['super_admin', 'agency', 'admin'].includes(authProfile?.role || '')) {
                targetId = impersonateId
            }
        }

        let body: any = {}
        try {
            body = await req.json()
        } catch {
            // Empty body for default 1-click assignment
        }

        // Fetch user's profile to verify KYC status
        const { data: targetProfile, error: profErr } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', targetId)
            .single()

        if (profErr || !targetProfile) {
            return NextResponse.json({ error: 'Failed to fetch user profile' }, { status: 500 })
        }

        let biKyc: any = {}
        try {
            if (targetProfile.business_info && typeof targetProfile.business_info === 'string') {
                biKyc = JSON.parse(targetProfile.business_info)
            } else if (targetProfile.business_info && typeof targetProfile.business_info === 'object') {
                biKyc = targetProfile.business_info
            }
        } catch (e) {
            biKyc = {}
        }

        let kycStatus = biKyc.kyc_status || 'not_submitted'
        const isWhitelisted = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com'].includes(targetProfile.email || '')

        // If not marked verified in DB, check Vobiz real-time
        if (!isWhitelisted && kycStatus !== 'verified') {
            const subIdentifier = biKyc.kyc_data?.vobizSubAuthId || biKyc.voice_vobiz_auth_id || targetProfile.email
            if (subIdentifier) {
                try {
                    const { getVobizSubAccount } = await import('@/utils/vobiz-helper')
                    const sub = await getVobizSubAccount(subIdentifier)
                    if (sub && sub.kyc_status === 'verified') {
                        kycStatus = 'verified'
                        biKyc.kyc_status = 'verified'
                        await supabaseAdmin
                            .from('profiles')
                            .update({ business_info: JSON.stringify(biKyc) })
                            .eq('id', targetId)
                    }
                } catch (e) {}
            }
        }

        // Verify KYC requirement before number buying/assignment
        if (kycStatus !== 'verified' && !isWhitelisted) {
            return NextResponse.json({
                error: 'KYC Verification Required: Please complete your Aadhaar/PAN or Company GST verification before provisioning a phone number.',
                requiresKyc: true
            }, { status: 403 })
        }

        // Enforce 1-free-number limit per account
        const currentVobizNumber = biKyc.voice_vobiz_number || (targetProfile.voice_twilio_number?.startsWith('+91') ? targetProfile.voice_twilio_number : '')
        if (currentVobizNumber) {
            return NextResponse.json({
                error: `You have already claimed your 1 free calling line (${currentVobizNumber}). Each account is limited to 1 complimentary line. You cannot claim additional numbers.`
            }, { status: 400 })
        }

        // Choose number: must be explicitly selected from catalog
        const requestedNumber = body.phoneNumber || body.number
        if (!requestedNumber) {
            return NextResponse.json({
                error: 'Please select a 79-series number from the list to claim your calling line.'
            }, { status: 400 })
        }

        // Format number to E.164
        let cleanNumber = requestedNumber.replace(/\D/g, '')
        if (!cleanNumber.startsWith('+')) {
            if (cleanNumber.length === 10) {
                cleanNumber = '+91' + cleanNumber
            } else {
                cleanNumber = '+' + cleanNumber
            }
        }

        // Check if number is already claimed by another user
        const { data: existingProfiles } = await supabaseAdmin
            .from('profiles')
            .select('id, email')
            .or(`voice_twilio_number.eq.${cleanNumber},business_info.ilike.%${cleanNumber}%`)

        if (existingProfiles && existingProfiles.length > 0 && !existingProfiles.some(p => p.id === targetId)) {
            return NextResponse.json({
                error: `The number ${cleanNumber} has already been claimed by another account. Please select another number from the catalog.`
            }, { status: 409 })
        }

        console.log(`[PROVISION] Assigning Vobiz number ${cleanNumber} to user ${targetId}...`)

        // Execute purchase on Vobiz API to claim from inventory
        const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
        const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'

        try {
            console.log(`[PROVISION] Purchasing number ${cleanNumber} from Vobiz inventory...`)
            const vobizPurchaseRes = await fetch(
                `https://api.vobiz.ai/api/v1/Account/${authId}/numbers/purchase-from-inventory`,
                {
                    method: 'POST',
                    headers: {
                        'X-Auth-ID': authId,
                        'X-Auth-Token': authToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ e164: cleanNumber })
                }
            )

            const vobizData = await vobizPurchaseRes.json().catch(() => ({}))
            console.log(`[PROVISION] Vobiz purchase response: status=${vobizPurchaseRes.status}`, vobizData)

            if (!vobizPurchaseRes.ok && vobizPurchaseRes.status !== 409) {
                const msg = vobizData.error || vobizData.message || `Carrier purchase error (HTTP ${vobizPurchaseRes.status})`
                if (!msg.toLowerCase().includes('already')) {
                    return NextResponse.json({ error: `Vobiz Telephony Error: ${msg}` }, { status: 400 })
                }
            }

            // Assign number to user's dedicated Vobiz subaccount if one exists
            // Note: Vobiz expects the Subaccount Auth ID (e.g. SA_CU21FXWZ) in sub_account_id field
            const targetSubAccountAuthId = biKyc.voice_vobiz_auth_id || biKyc.kyc_data?.vobizSubAuthId || biKyc.voice_vobiz_sub_account_id
            if (targetSubAccountAuthId) {
                console.log(`[PROVISION] Assigning number ${cleanNumber} to customer subaccount ${targetSubAccountAuthId}...`)
                try {
                    const assignRes = await fetch(
                        `https://api.vobiz.ai/api/v1/account/${authId}/numbers/${encodeURIComponent(cleanNumber)}/assign-subaccount`,
                        {
                            method: 'POST',
                            headers: {
                                'X-Auth-ID': authId,
                                'X-Auth-Token': authToken,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ sub_account_id: String(targetSubAccountAuthId) })
                        }
                    )
                    const assignData = await assignRes.json().catch(() => ({}))
                    console.log(`[PROVISION] Subaccount assignment response: status=${assignRes.status}`, assignData)
                } catch (assignErr: any) {
                    console.warn('[PROVISION] Error assigning number to subaccount:', assignErr.message)
                }
            }
        } catch (vErr: any) {
            console.warn('[PROVISION] Vobiz network purchase warning:', vErr.message)
        }

        // Update profile with the assigned Vobiz calling number
        biKyc.voice_vobiz_number = cleanNumber
        biKyc.claimed_vobiz_number = cleanNumber
        biKyc.claimed_at = new Date().toISOString()
        biKyc.voice_telephony_provider = 'vobiz'
        const updatePayload: any = {
            voice_twilio_number: cleanNumber, // primary calling line stored in DB
            voice_provider: 'vobiz',
            business_info: JSON.stringify(biKyc),
            old_voice_twilio_number: null
        }

        const { error: updateErr } = await supabaseAdmin
            .from('profiles')
            .update(updatePayload)
            .eq('id', targetId)

        if (updateErr) {
            console.error('[PROVISION] Failed to save assigned number:', updateErr)
            return NextResponse.json({ error: 'Failed to update assigned number in database: ' + updateErr.message }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            phoneNumber: cleanNumber,
            message: `Number ${cleanNumber} assigned successfully! Ready to make AI calls.`
        })
    } catch (e: any) {
        console.error('[PROVISION ERROR]', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function DELETE(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        const impersonateId = url.searchParams.get('impersonate')

        let targetId = user.id
        if (impersonateId) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()
            if (['super_admin', 'agency', 'admin'].includes(authProfile?.role || '')) {
                targetId = impersonateId
            }
        }

        const { data: targetProfile } = await supabaseAdmin
            .from('profiles')
            .select('voice_twilio_number, business_info')
            .eq('id', targetId)
            .single()

        const currentNum = targetProfile?.voice_twilio_number
        let bi: any = {}
        try {
            bi = typeof targetProfile?.business_info === 'string' ? JSON.parse(targetProfile.business_info) : (targetProfile?.business_info || {})
        } catch (e) {}
        delete bi.voice_vobiz_number
        delete bi.claimed_vobiz_number

        // Unassign number from Vobiz subaccount if assigned
        const subAccountAuthId = bi.voice_vobiz_auth_id || bi.kyc_data?.vobizSubAuthId || bi.voice_vobiz_sub_account_id
        const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
        const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'

        if (subAccountAuthId && currentNum && currentNum.startsWith('+91')) {
            try {
                console.log(`[PROVISION] Unassigning number ${currentNum} from subaccount ${subAccountAuthId}...`)
                await fetch(
                    `https://api.vobiz.ai/api/v1/account/${authId}/numbers/${encodeURIComponent(currentNum)}/assign-subaccount`,
                    {
                        method: 'DELETE',
                        headers: {
                            'X-Auth-ID': authId,
                            'X-Auth-Token': authToken,
                            'Content-Type': 'application/json'
                        }
                    }
                )
            } catch (unassignErr: any) {
                console.warn('[PROVISION] Error unassigning number from subaccount:', unassignErr.message)
            }
        }

        console.log(`[PROVISION] Disconnecting voice number for user ${targetId}...`)

        await supabaseAdmin
            .from('profiles')
            .update({
                voice_twilio_number: null,
                business_info: JSON.stringify(bi),
                old_voice_twilio_number: currentNum
            })
            .eq('id', targetId)

        return NextResponse.json({
            success: true,
            message: 'Voice calling number disconnected successfully.'
        })
    } catch (e: any) {
        console.error('[PROVISION DELETE ERROR]', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
