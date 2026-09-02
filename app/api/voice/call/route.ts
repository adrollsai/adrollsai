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

        // Check if caller is an agent account
        const { data: callerProfile } = await supabaseAdmin
            .from('profiles')
            .select('role, parent_id, agency_id')
            .eq('id', user.id)
            .single()

        if (!isAutoTrigger && (callerProfile?.role === 'agent' || callerProfile?.role === 'team_member')) {
            return NextResponse.json({ error: 'Agent accounts are not permitted to initiate AI calls.' }, { status: 403 })
        }

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

        const targets: string[] = []
        if (leadId) targets.push(leadId)
        if (Array.isArray(leadIds)) targets.push(...leadIds)

        if (targets.length === 0) {
            return NextResponse.json({ error: 'No lead targets provided.' }, { status: 400 })
        }

        // If targetLead has an owner user_id and targetId wasn't explicitly impersonated, resolve to lead's owner
        if (targets.length === 1 && !impersonateId) {
            const { data: leadOwner } = await supabaseAdmin
                .from('leads')
                .select('user_id')
                .eq('id', targets[0])
                .maybeSingle()
            if (leadOwner?.user_id) {
                targetId = leadOwner.user_id
            }
        }

        // Fetch credentials of targetId
        const { data: profile, error: profErr } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', targetId)
            .single()

        if (profErr || !profile) {
            return NextResponse.json({ error: 'Failed to fetch user profile.' }, { status: 500 })
        }

        const telephonyProvider = profile.voice_telephony_provider || profile.telephony_provider || 'twilio'
        const isMasterDefaultUser = profile.email === 'rchopra489@gmail.com' || profile.email === 'infobluesquareinfra@gmail.com'
        let voiceNumber = profile.voice_twilio_number || process.env.MASTER_TWILIO_NUMBER || (isMasterDefaultUser ? process.env.MASTER_TWILIO_NUMBER : null)
        if (voiceNumber === '+911171366938' || voiceNumber?.startsWith('+91')) {
            voiceNumber = process.env.MASTER_TWILIO_NUMBER || '+16592137728'
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

