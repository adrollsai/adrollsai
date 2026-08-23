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

        const saasMode = true
        const isMasterDefaultUser = profile?.email === 'rchopra489@gmail.com' || profile?.email === 'infobluesquareinfra@gmail.com'
        
        const telephonyProvider = profile?.voice_telephony_provider || 'vobiz'
        let voiceNumber = ''
        if (telephonyProvider === 'vobiz') {
            if (profile?.voice_twilio_number && profile.voice_twilio_number.startsWith('+91')) {
                voiceNumber = profile.voice_twilio_number
            } else if (profile?.voice_vobiz_number) {
                voiceNumber = profile.voice_vobiz_number
            } else if (isMasterDefaultUser) {
                voiceNumber = process.env.VOBIZ_TEST_NUMBER || '+911171366938'
            } else {
                voiceNumber = process.env.VOBIZ_TEST_NUMBER || '+911171366938'
            }
        } else {
            voiceNumber = profile?.voice_twilio_number || (isMasterDefaultUser ? process.env.MASTER_TWILIO_NUMBER : '')
        }

        return NextResponse.json({
            success: true,
            saasMode,
            voiceNumber,
            telephonyProvider,
            concurrencyLimit: profile?.voice_concurrency_limit || 1,
            cpsLimit: profile?.voice_cps_limit || 1,
            kycStatus: profile?.kyc_status || 'not_submitted',
            kycType: profile?.kyc_type || 'individual',
            credits: profile?.credits || 0
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
