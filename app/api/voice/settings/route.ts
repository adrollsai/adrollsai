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
            .select('voice_twilio_number, email')
            .eq('id', targetId)
            .single()

        const saasMode = !!(process.env.MASTER_TWILIO_SID && process.env.MASTER_TWILIO_TOKEN)
        const isMasterDefaultUser = profile?.email === 'rchopra489@gmail.com' || profile?.email === 'infobluesquareinfra@gmail.com'
        const voiceNumber = profile?.voice_twilio_number || (isMasterDefaultUser ? process.env.MASTER_TWILIO_NUMBER : '')

        return NextResponse.json({
            success: true,
            saasMode,
            voiceNumber
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
