import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { triggerOutboundCall } from '@/utils/voice-helper'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const { questionId, answer } = await req.json()
        if (!questionId) {
            return NextResponse.json({ error: 'Missing questionId' }, { status: 400 })
        }

        // 1. Fetch flagged question details
        const { data: fq, error: fetchErr } = await supabaseAdmin
            .from('flagged_questions')
            .select('*')
            .eq('id', questionId)
            .single()

        if (fetchErr || !fq) {
            return NextResponse.json({ error: 'Flagged question not found' }, { status: 404 })
        }

        if (answer) {
            // 2. Fetch profile details (to append answer to business_info context)
            const { data: profile, error: profileErr } = await supabaseAdmin
                .from('profiles')
                .select('business_info')
                .eq('id', fq.user_id)
                .single()

            if (profileErr || !profile) {
                return NextResponse.json({ error: 'Workspace profile not found' }, { status: 404 })
            }

            // 3. Append to business_info (AI context)
            const originalInfo = profile.business_info || ''
            const updatedInfo = `${originalInfo}\n\nQ: ${fq.question}\nA: ${answer}`

            // 4. Update profile business_info
            const { error: profileUpdateErr } = await supabaseAdmin
                .from('profiles')
                .update({ business_info: updatedInfo })
                .eq('id', fq.user_id)

            if (profileUpdateErr) {
                return NextResponse.json({ error: 'Failed to update business profile info: ' + profileUpdateErr.message }, { status: 500 })
            }
        }

        // 5. Update flagged_questions resolved and answer columns
        const { error: fqUpdateErr } = await supabaseAdmin
            .from('flagged_questions')
            .update({
                resolved: true,
                answer: answer || null
            })
            .eq('id', questionId)

        if (fqUpdateErr) {
            return NextResponse.json({ error: 'Failed to resolve flagged question: ' + fqUpdateErr.message }, { status: 500 })
        }

        // 6. Trigger outbound call to the lead regarding this resolved doubt!
        let callSuccess = false
        let callError = null
        
        if (answer) {
            console.log(`[RESOLVE QUESTION] Triggering auto-retry outbound voice call for lead ${fq.lead_id} under profile ${fq.user_id}`)
            try {
                const callRes = await triggerOutboundCall(supabaseAdmin, fq.lead_id, fq.user_id, true)
                callSuccess = callRes.success
                if (!callRes.success) {
                    callError = callRes.error
                }
            } catch (callErr: any) {
                console.error('[RESOLVE QUESTION] Outbound call trigger failed:', callErr)
                callError = callErr.message || callErr
            }
        }

        return NextResponse.json({
            success: true,
            message: answer ? 'Flagged question resolved and outbound call triggered!' : 'Flagged question dismissed.',
            callTriggered: answer ? callSuccess : false,
            callError
        })

    } catch (e: any) {
        console.error('[RESOLVE QUESTION] Unexpected error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
