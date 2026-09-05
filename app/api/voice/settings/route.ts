import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: Request) {
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

        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', targetId)
            .single()

        const isNobogentMaster = profile?.email === 'rchopra489@gmail.com'
        const telephonyProvider = profile?.voice_telephony_provider || 'vobiz'
        
        let voiceNumber = ''
        if (profile?.voice_twilio_number) {
            voiceNumber = profile.voice_twilio_number
        } else if (profile?.voice_vobiz_number) {
            voiceNumber = profile.voice_vobiz_number
        } else if (isNobogentMaster) {
            voiceNumber = process.env.VOBIZ_TEST_NUMBER || '+911171366938'
        }

        let biKyc: any = {}
        try {
            if (profile?.business_info && typeof profile.business_info === 'string') {
                biKyc = JSON.parse(profile.business_info)
            } else if (profile?.business_info && typeof profile.business_info === 'object') {
                biKyc = profile.business_info
            }
        } catch (e) {}

        let kycStatus = isNobogentMaster ? 'verified' : (biKyc.kyc_status || 'not_submitted')
        let kycType = isNobogentMaster ? 'business' : (biKyc.kyc_type || 'individual')
        let kycData = isNobogentMaster 
            ? (biKyc.kyc_data || { email: 'nobogent@gmail.com', fullName: 'Nobogent', companyName: 'Nobogent', entityType: 'business' })
            : (biKyc.kyc_data || {})

        // Real-time auto-sync with Vobiz if subaccount is registered but status is not yet verified in DB
        if (!isNobogentMaster && kycStatus !== 'verified') {
            const subIdentifier = kycData?.vobizSubAuthId || biKyc.voice_vobiz_auth_id || kycData?.email || profile?.email
            if (subIdentifier) {
                try {
                    const { getVobizSubAccount } = await import('@/utils/vobiz-helper')
                    const sub = await getVobizSubAccount(subIdentifier)
                    if (sub && sub.kyc_status === 'verified') {
                        kycStatus = 'verified'
                        kycData.vobizKycStatus = 'verified'
                        kycData.vobizSubAuthId = sub.auth_id || kycData.vobizSubAuthId
                        kycData.vobizSubAccountId = String(sub.id) || kycData.vobizSubAccountId
                        biKyc.kyc_status = 'verified'
                        biKyc.kyc_data = kycData
                        biKyc.voice_vobiz_auth_id = sub.auth_id || biKyc.voice_vobiz_auth_id
                        biKyc.voice_vobiz_auth_token = sub.auth_token || biKyc.voice_vobiz_auth_token
                        biKyc.voice_vobiz_sub_account_id = String(sub.id) || biKyc.voice_vobiz_sub_account_id

                        // Sync in database
                        await supabase
                            .from('profiles')
                            .update({ business_info: JSON.stringify(biKyc) })
                            .eq('id', targetId)
                    }
                } catch (syncErr: any) {
                    console.warn('[VOICE SETTINGS] Vobiz KYC sync notice:', syncErr.message)
                }
            }
        }

        return NextResponse.json({
            success: true,
            saasMode: true,
            voiceNumber,
            telephonyProvider,
            concurrencyLimit: profile?.voice_concurrency_limit || 3,
            cpsLimit: profile?.voice_cps_limit || 1,
            kycStatus,
            kycType,
            kycData,
            credits: profile?.credits || 0
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
