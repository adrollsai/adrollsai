import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { data: profile } = await supabase
            .from('profiles')
            .select('voice_twilio_number')
            .eq('id', user.id)
            .single()

        const saasMode = !!(process.env.MASTER_TWILIO_SID && process.env.MASTER_TWILIO_TOKEN)

        return NextResponse.json({
            success: true,
            saasMode,
            voiceNumber: profile?.voice_twilio_number || ''
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
