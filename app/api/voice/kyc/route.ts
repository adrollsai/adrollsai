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

        let bi: any = {}
        try {
            if (profile.business_info && typeof profile.business_info === 'string') {
                bi = JSON.parse(profile.business_info)
            } else if (profile.business_info && typeof profile.business_info === 'object') {
                bi = profile.business_info
            }
        } catch (e) {
            bi = {}
        }

        const isNobogentMaster = profile.email === 'rchopra489@gmail.com'
        let kycStatus = isNobogentMaster ? 'verified' : (bi.kyc_status || 'not_submitted')
        let kycType = isNobogentMaster ? 'business' : (bi.kyc_type || 'individual')
        let kycData = isNobogentMaster 
            ? (bi.kyc_data || { email: 'nobogent@gmail.com', fullName: 'Nobogent', companyName: 'Nobogent', entityType: 'business' })
            : (bi.kyc_data || {})

        if (!isNobogentMaster && kycStatus !== 'verified') {
            const subId = kycData?.vobizSubAuthId || bi.voice_vobiz_auth_id || kycData?.email || profile.email
            if (subId) {
                try {
                    const { getVobizSubAccount } = await import('@/utils/vobiz-helper')
                    const sub = await getVobizSubAccount(subId)
                    if (sub && sub.kyc_status === 'verified') {
                        kycStatus = 'verified'
                        kycData.vobizKycStatus = 'verified'
                        kycData.vobizSubAuthId = sub.auth_id || kycData.vobizSubAuthId
                        bi.kyc_status = 'verified'
                        bi.kyc_data = kycData
                        await supabaseAdmin
                            .from('profiles')
                            .update({ business_info: JSON.stringify(bi) })
                            .eq('id', targetId)
                    }
                } catch (e) {}
            }
        }

        return NextResponse.json({
            success: true,
            kyc: {
                status: kycStatus,
                type: kycType,
                data: kycData,
                submittedAt: bi.kyc_submitted_at || null,
                verifiedAt: bi.kyc_verified_at || null,
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

        // Dispatch official Telecom KYC verification email to subAccountEmail
        try {
            const { sendGenericEmail } = await import('@/utils/email-helper')
            const isVerifiedNow = finalKycStatus === 'verified'
            const subject = isVerifiedNow
                ? `✅ Telecom TRAI KYC Verified: Outbound Calling Line Unlocked (${subAccountName})`
                : `Action Required: Complete Telecom TRAI KYC Verification (${subAccountName})`

            const emailHtml = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
                    <div style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid ${isVerifiedNow ? '#10b981' : '#6366f1'};">
                        <h1 style="color: #0f172a; font-size: 20px; font-weight: 800; margin: 0;">Nobogent AI Telephony</h1>
                        <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Mandatory TRAI Indian Telecom Carrier Verification</p>
                    </div>

                    <div style="background-color: ${isVerifiedNow ? '#f0fdf4' : '#fefce8'}; border: 1px solid ${isVerifiedNow ? '#bbf7d0' : '#fef08a'}; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                        <h3 style="color: ${isVerifiedNow ? '#166534' : '#854d0e'}; margin: 0 0 6px 0; font-size: 15px; font-weight: 700;">
                            ${isVerifiedNow ? '🎉 KYC Verification Complete' : '⏳ Action Required: Complete Verification'}
                        </h3>
                        <p style="color: ${isVerifiedNow ? '#15803d' : '#a16207'}; font-size: 13px; margin: 0; line-height: 1.5;">
                            ${isVerifiedNow 
                                ? `Your telecom registration for <strong>${subAccountName}</strong> is fully verified with our carrier partner (Vobiz). Your outbound calling line is active and ready to make automated AI calls.` 
                                : `Your telecom sub-account for <strong>${subAccountName}</strong> has been registered. Under Telecom Regulatory Authority of India (TRAI) directives, commercial AI calls require mandatory business/individual verification.`
                            }
                        </p>
                    </div>

                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 0; font-weight: 700; color: #64748b; font-size: 12px; text-transform: uppercase;">Entity / Legal Name:</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 600; font-size: 14px;">${subAccountName}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 0; font-weight: 700; color: #64748b; font-size: 12px; text-transform: uppercase;">Registered Email:</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 600; font-size: 14px;">${subAccountEmail}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 0; font-weight: 700; color: #64748b; font-size: 12px; text-transform: uppercase;">Sub-Account ID:</td>
                            <td style="padding: 10px 0; color: #4338ca; font-weight: 700; font-size: 14px; font-family: monospace;">${subAuthId || 'Registered'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px 0; font-weight: 700; color: #64748b; font-size: 12px; text-transform: uppercase;">KYC Status:</td>
                            <td style="padding: 10px 0; color: ${isVerifiedNow ? '#16a34a' : '#ea580c'}; font-weight: 800; font-size: 13px; text-transform: uppercase;">
                                ${finalKycStatus}
                            </td>
                        </tr>
                    </table>

                    ${!isVerifiedNow ? `
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="https://app.nobogent.com/dashboard/voice-agent" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 12px 28px; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 9999px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            Open Voice Agent Settings
                        </a>
                    </div>
                    ` : `
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="https://app.nobogent.com/dashboard/voice-agent" style="display: inline-block; background-color: #059669; color: #ffffff; padding: 12px 28px; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 9999px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            Launch AI Calling Campaign
                        </a>
                    </div>
                    `}

                    <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px; text-align: center;">
                        <p style="margin: 0; font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase;">
                            Powered by Nobogent AI Telephony • Support: support@nobogent.com
                        </p>
                    </div>
                </div>
            `

            await sendGenericEmail(
                subAccountEmail,
                subject,
                emailHtml,
                ['rchopra489@gmail.com']
            )
            console.log(`[KYC EMAIL DISPATCH] Sent to ${subAccountEmail} with status: ${finalKycStatus}`)
        } catch (emailErr: any) {
            console.error('[KYC EMAIL DISPATCH ERROR]', emailErr.message)
        }

        return NextResponse.json({
            success: true,
            message: `KYC verification mail has been dispatched to ${subAccountEmail}.`,
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
