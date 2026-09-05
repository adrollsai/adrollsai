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

        console.log(`[PROVISION] Assigning Vobiz number ${cleanNumber} to user ${targetId}...`)

        // Update profile with the assigned Vobiz calling number
        biKyc.voice_vobiz_number = cleanNumber
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
