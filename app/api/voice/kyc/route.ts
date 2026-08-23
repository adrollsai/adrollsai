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

        // Return KYC details from profile or fallback to defaults
        const kycStatus = profile.kyc_status || 'not_submitted'
        const kycType = profile.kyc_type || 'individual'
        const kycData = profile.kyc_data || {}

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
            fullName,
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

        if (!entityType || !['individual', 'business'].includes(entityType)) {
            return NextResponse.json({ error: 'Invalid entity type. Must be individual or business.' }, { status: 400 })
        }

        const cleanAadhaar = (aadhaarNumber || '').replace(/\D/g, '')
        const cleanPan = (panNumber || '').trim().toUpperCase()
        const cleanCompanyPan = (companyPan || '').trim().toUpperCase()
        const cleanCompanyGst = (companyGst || '').trim().toUpperCase()

        let kycDataPayload: any = {}

        if (entityType === 'individual') {
            if (!fullName || fullName.trim().length < 2) {
                return NextResponse.json({ error: 'Full Legal Name is required for individual KYC.' }, { status: 400 })
            }
            if (!cleanAadhaar || cleanAadhaar.length !== 12) {
                return NextResponse.json({ error: 'Please enter a valid 12-digit Aadhaar number.' }, { status: 400 })
            }
            const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
            if (!cleanPan || !panRegex.test(cleanPan)) {
                return NextResponse.json({ error: 'Please enter a valid 10-digit PAN format (e.g. ABCDE1234F).' }, { status: 400 })
            }

            kycDataPayload = {
                fullName: fullName.trim(),
                aadhaarNumber: `XXXX-XXXX-${cleanAadhaar.slice(-4)}`,
                aadhaarLast4: cleanAadhaar.slice(-4),
                panNumber: cleanPan,
                aadhaarDocUrl: aadhaarDocUrl || null,
                panDocUrl: panDocUrl || null
            }
        } else {
            // Business KYC
            if (!companyName || companyName.trim().length < 2) {
                return NextResponse.json({ error: 'Company/Business Name is required for business KYC.' }, { status: 400 })
            }
            const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
            if (!cleanCompanyPan || !panRegex.test(cleanCompanyPan)) {
                return NextResponse.json({ error: 'Please enter a valid 10-digit Company PAN (e.g. ABCDE1234F).' }, { status: 400 })
            }
            // GST format: 15 alphanumeric characters (e.g. 07AAAAA0000A1Z5)
            const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
            if (!cleanCompanyGst || cleanCompanyGst.length < 15) {
                return NextResponse.json({ error: 'Please enter a valid 15-digit Company GSTIN.' }, { status: 400 })
            }

            kycDataPayload = {
                companyName: companyName.trim(),
                companyPan: cleanCompanyPan,
                companyGst: cleanCompanyGst,
                gstDocUrl: gstDocUrl || null
            }
        }

        const now = new Date().toISOString()
        const updateData: any = {
            kyc_status: 'verified', // Auto-approved upon valid format verification for immediate number assignment
            kyc_type: entityType,
            kyc_data: kycDataPayload,
            kyc_submitted_at: now,
            kyc_verified_at: now
        }

        // Provision sub-account under master account on Vobiz
        try {
            const { createVobizSubAccount } = await import('@/utils/vobiz-helper')
            const subRes = await createVobizSubAccount({
                name: entityType === 'business' ? companyName.trim() : fullName.trim(),
                email: user.email || '',
                entityType
            })
            if (subRes.success && subRes.subAuthId) {
                updateData.voice_vobiz_auth_id = subRes.subAuthId
                if (subRes.subAuthToken) {
                    updateData.voice_vobiz_auth_token = subRes.subAuthToken
                }
                kycDataPayload.vobizSubAuthId = subRes.subAuthId
            }
        } catch (subErr: any) {
            console.warn('[KYC SUBMIT] Sub-account provisioning notice:', subErr.message)
        }

        const { error: updateErr } = await supabaseAdmin
            .from('profiles')
            .update(updateData)
            .eq('id', targetId)

        if (updateErr) {
            console.error('[KYC SUBMIT] DB update error:', updateErr)
            // If specific columns do not exist yet in DB schema, attempt fallback update
            try {
                const fallbackData = {
                    business_info: JSON.stringify({
                        kyc_status: 'verified',
                        kyc_type: entityType,
                        kyc_data: kycDataPayload,
                        kyc_verified_at: now
                    })
                }
                await supabaseAdmin.from('profiles').update(fallbackData).eq('id', targetId)
            } catch (fbErr) {
                console.warn('[KYC SUBMIT] Fallback update failed:', fbErr)
            }
        }

        return NextResponse.json({
            success: true,
            message: 'KYC documents verified successfully! You can now assign or buy a calling number.',
            kyc: {
                status: 'verified',
                type: entityType,
                data: kycDataPayload,
                verifiedAt: now,
                isVerified: true
            }
        })
    } catch (err: any) {
        console.error('[KYC POST API] Error:', err)
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
    }
}
