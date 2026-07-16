import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { triggerOutboundCall, dispatchNextCall } from '@/utils/voice-helper'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const supabaseAdmin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await req.json()
        const { leadId, leadIds, isAutoTrigger, impersonate } = body

        const url = new URL(req.url)
        let impersonateId = url.searchParams.get('impersonate') || impersonate

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

        // Fetch credentials of targetId
        const { data: profile, error: profErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', targetId)
            .single()

        if (profErr || !profile) {
            return NextResponse.json({ error: 'Failed to fetch user profile.' }, { status: 500 })
        }

        const twilioSid = profile.voice_twilio_sid || process.env.MASTER_TWILIO_SID || process.env.DEV_TWILIO_SID
        const twilioToken = profile.voice_twilio_token || process.env.MASTER_TWILIO_TOKEN || process.env.DEV_TWILIO_TOKEN
        
        const isMasterDefaultUser = profile.email === 'rchopra489@gmail.com' || profile.email === 'infobluesquareinfra@gmail.com'
        const voiceNumber = profile.voice_twilio_number || (isMasterDefaultUser ? process.env.MASTER_TWILIO_NUMBER : null)

        if (!twilioSid || !twilioToken || !voiceNumber) {
            return NextResponse.json({ 
                error: 'Voice calling credentials or phone number are not configured. Please provision a phone number in Voice settings.' 
            }, { status: 400 })
        }

        const targets: string[] = []
        if (leadId) targets.push(leadId)
        if (Array.isArray(leadIds)) targets.push(...leadIds)

        if (targets.length === 0) {
            return NextResponse.json({ error: 'No lead targets provided.' }, { status: 400 })
        }

        const isAuto = !!isAutoTrigger

        if (targets.length === 1) {
            const targetLeadId = targets[0]
            const res = await triggerOutboundCall(supabaseAdmin, targetLeadId, targetId, isAuto)
            return NextResponse.json({ success: true, results: [{ leadId: targetLeadId, ...res }] })
        } else {
            const campaignName = `CRM Bulk Call - ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN')}`
            
            const { data: newCampaign, error: campErr } = await supabaseAdmin
                .from('voice_campaigns')
                .insert({
                    user_id: targetId,
                    name: campaignName,
                    audience_filter: { type: 'crm_bulk' },
                    status: 'running'
                })
                .select()
                .single()

            if (campErr || !newCampaign) {
                console.error('[CRM BULK VOICE] Failed to create dynamic campaign:', campErr)
                return NextResponse.json({ error: 'Failed to create bulk call campaign: ' + (campErr?.message || 'Unknown') }, { status: 500 })
            }

            const { error: updateErr } = await supabaseAdmin
                .from('leads')
                .update({ 
                    voice_campaign_id: newCampaign.id,
                    voice_call_status: 'not_called'
                })
                .in('id', targets)

            if (updateErr) {
                console.error('[CRM BULK VOICE] Failed to assign leads to campaign:', updateErr)
                return NextResponse.json({ error: 'Failed to assign leads: ' + updateErr.message }, { status: 500 })
            }

            dispatchNextCall(supabaseAdmin, targetId).catch((runErr: any) => {
                console.error('[CRM BULK ASYNC RUNNER ERROR]', runErr)
            })

            const mockResults = targets.map(tid => ({ leadId: tid, success: true, message: 'Queued sequentially' }))
            return NextResponse.json({ success: true, results: mockResults })
        }
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

