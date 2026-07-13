import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { triggerOutboundCall } from '@/utils/voice-helper'

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // Fetch credentials
        const { data: profile, error: profErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single()

        if (profErr || !profile) {
            return NextResponse.json({ error: 'Failed to fetch user profile.' }, { status: 500 })
        }

        const twilioSid = process.env.MASTER_TWILIO_SID || process.env.DEV_TWILIO_SID
        const twilioToken = process.env.MASTER_TWILIO_TOKEN || process.env.DEV_TWILIO_TOKEN
        const voiceNumber = profile.voice_twilio_number || process.env.MASTER_TWILIO_NUMBER

        if (!twilioSid || !twilioToken || !voiceNumber) {
            return NextResponse.json({ 
                error: 'Voice calling credentials or phone number are not configured. Please contact support or set up your phone settings.' 
            }, { status: 400 })
        }

        const body = await req.json()
        const { leadId, leadIds, isAutoTrigger } = body

        const targets: string[] = []
        if (leadId) targets.push(leadId)
        if (Array.isArray(leadIds)) targets.push(...leadIds)

        if (targets.length === 0) {
            return NextResponse.json({ error: 'No lead targets provided.' }, { status: 400 })
        }

        const results = []
        const isAuto = !!isAutoTrigger

        for (const targetId of targets) {
            const res = await triggerOutboundCall(supabase, targetId, user.id, isAuto)
            results.push({ leadId: targetId, ...res })
        }

        return NextResponse.json({ success: true, results })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

