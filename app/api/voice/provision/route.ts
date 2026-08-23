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

        const isWhitelisted = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com'].includes(targetProfile.email || '')
        const kycStatus = targetProfile.kyc_status

        // Verify KYC requirement before number buying/assignment
        if (kycStatus !== 'verified' && !isWhitelisted) {
            return NextResponse.json({
                error: 'KYC Verification Required: Please complete your Aadhaar/PAN or Company GST verification before provisioning a phone number.',
                requiresKyc: true
            }, { status: 403 })
        }

        // Choose number: specific requested number or default Vobiz number from catalog
        let requestedNumber = body.phoneNumber || body.number
        if (!requestedNumber) {
            // 1-Click Provision: Assign first popular available number or default Vobiz test number
            const popular = VOBIZ_NUMBER_CATALOG.find(n => n.isPopular) || VOBIZ_NUMBER_CATALOG[0]
            requestedNumber = popular?.phoneNumber || process.env.VOBIZ_TEST_NUMBER || '+911171366938'
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
        const updatePayload: any = {
            voice_vobiz_number: cleanNumber,
            voice_twilio_number: cleanNumber, // keep in sync for backwards compatibility
            voice_telephony_provider: 'vobiz',
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
            .select('voice_vobiz_number, voice_twilio_number')
            .eq('id', targetId)
            .single()

        const currentNum = targetProfile?.voice_vobiz_number || targetProfile?.voice_twilio_number

        console.log(`[PROVISION] Disconnecting voice number for user ${targetId}...`)

        await supabaseAdmin
            .from('profiles')
            .update({
                voice_vobiz_number: null,
                voice_twilio_number: null,
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
