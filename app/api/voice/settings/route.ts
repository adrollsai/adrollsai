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

        const kycStatus = isNobogentMaster ? 'verified' : (biKyc.kyc_status || profile?.kyc_status || 'not_submitted')
        const kycType = isNobogentMaster ? 'business' : (biKyc.kyc_type || profile?.kyc_type || 'individual')
        const kycData = isNobogentMaster 
            ? (biKyc.kyc_data || profile?.kyc_data || { email: 'nobogent@gmail.com', fullName: 'Nobogent', companyName: 'Nobogent', entityType: 'business' })
            : (biKyc.kyc_data || profile?.kyc_data || {})

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
