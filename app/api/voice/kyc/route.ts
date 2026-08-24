import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        let targetId = user.id
        const impersonateId = url.searchParams.get('impersonate')
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

        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', targetId)
            .single()

        if (error || !profile) {
            return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
        }

        const isNobogentMaster = profile.email === 'rchopra489@gmail.com'
        const kycStatus = isNobogentMaster ? 'verified' : (profile.kyc_status || 'not_submitted')
        const kycType = isNobogentMaster ? 'business' : (profile.kyc_type || 'individual')
        const kycData = isNobogentMaster 
            ? (profile.kyc_data || { email: 'nobogent@gmail.com', fullName: 'Nobogent', companyName: 'Nobogent', entityType: 'business' })
            : (profile.kyc_data || {})

        return NextResponse.json({
            success: true,
            kyc: {
                status: kycStatus,
                type: kycType,
                data: kycData,
                submittedAt: profile.kyc_submitted_at || null,
                verifiedAt: profile.kyc_verified_at || null,
                isVerified: kycStatus === 'verified'
            }
        })
    } catch (err: any) {
        console.error('[KYC GET API] Error:', err)
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await req.json()
        const {
            entityType, // 'individual' | 'business'
            kycMode, // 'personal_use' | 'customer_use'
            name,
            fullName,
            email,
            phone,
            description,
            aadhaarNumber,
            panNumber,
            aadhaarDocUrl,
            panDocUrl,
            companyName,
            companyPan,
            companyGst,
            gstDocUrl,
            impersonate
        } = body

        const url = new URL(req.url)
        let targetId = user.id
        const impersonateId = url.searchParams.get('impersonate') || impersonate
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

        const effectiveEntityType = entityType === 'business' ? 'business' : 'individual'
        const effectiveKycMode = 'customer_use'
        const subAccountName = (name || companyName || fullName || '').trim()
        const subAccountEmail = (email || user.email || '').trim()
        const subAccountPhone = (phone || '').trim()

        if (!subAccountName || subAccountName.length < 2) {
            return NextResponse.json({ error: 'Business / Legal Name is required.' }, { status: 400 })
        }
        if (!subAccountEmail || !subAccountEmail.includes('@')) {
            return NextResponse.json({ error: 'A valid email address is required for KYC verification.' }, { status: 400 })
        }
        if (!subAccountPhone || subAccountPhone.replace(/\D/g, '').length < 10) {
            return NextResponse.json({ error: 'A valid 10-digit contact phone number is required.' }, { status: 400 })
        }

        let kycDataPayload: any = {
            name: subAccountName,
            fullName: subAccountName,
            companyName: subAccountName,
            email: subAccountEmail,
            phone: subAccountPhone,
            description: description || `AI Calling Sub-account for ${subAccountName}`,
            kycMode: effectiveKycMode,
            entityType: effectiveEntityType
        }

        const now = new Date().toISOString()

        // Provision sub-account under master account on Vobiz (Customer Use Mode)
        let subAuthId = ''
        let subAuthToken = ''
        let subAccountId = ''
        let vobizKycStatus = 'pending'

        try {
            const { createVobizSubAccount } = await import('@/utils/vobiz-helper')
            const subRes = await createVobizSubAccount({
                name: subAccountName,
                email: subAccountEmail,
                phone: subAccountPhone,
                description: description || `Nobogent AI Calling for ${subAccountName}`,
                kycMode: effectiveKycMode,
                entityType: effectiveEntityType
            })
            if (subRes.success && subRes.subAuthId) {
                subAuthId = subRes.subAuthId
                subAuthToken = subRes.subAuthToken || ''
                subAccountId = subRes.subAccount?.id || ''
                vobizKycStatus = subRes.subAccount?.kyc_status || 'pending'
                kycDataPayload.vobizSubAuthId = subAuthId
                kycDataPayload.vobizSubAccountId = subAccountId
                kycDataPayload.vobizKycStatus = vobizKycStatus
            }
        } catch (subErr: any) {
            console.warn('[KYC SUBMIT] Sub-account provisioning notice:', subErr.message)
        }

        // Save safely into business_info
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', targetId)
            .single()

        let existingBi: any = {}
        try {
            if (profile?.business_info && typeof profile.business_info === 'string') {
                existingBi = JSON.parse(profile.business_info)
            } else if (profile?.business_info && typeof profile.business_info === 'object') {
                existingBi = profile.business_info
            }
        } catch (e) {
            existingBi = { bio: profile?.business_info || '' }
        }

        const isMaster = profile?.email === 'rchopra489@gmail.com'
        const finalKycStatus = isMaster ? 'verified' : (vobizKycStatus === 'verified' ? 'verified' : 'pending')

        const updatedBi = {
            ...existingBi,
            kyc_status: finalKycStatus,
            kyc_type: effectiveEntityType,
            kyc_data: kycDataPayload,
            kyc_submitted_at: now,
            voice_vobiz_auth_id: subAuthId || existingBi.voice_vobiz_auth_id || '',
            voice_vobiz_auth_token: subAuthToken || existingBi.voice_vobiz_auth_token || '',
            voice_vobiz_sub_account_id: subAccountId || existingBi.voice_vobiz_sub_account_id || ''
        }

        await supabaseAdmin
            .from('profiles')
            .update({
                business_info: JSON.stringify(updatedBi)
            })
            .eq('id', targetId)

        return NextResponse.json({
            success: true,
            message: `Sub-account created on Vobiz! KYC verification mail has been sent to ${subAccountEmail}.`,
            kyc: {
                status: finalKycStatus,
                type: effectiveEntityType,
                data: kycDataPayload,
                submittedAt: now,
                isVerified: finalKycStatus === 'verified',
                vobizSubAuthId: subAuthId
            }
        })
    } catch (err: any) {
        console.error('[KYC POST API] Error:', err)
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
    }
}
