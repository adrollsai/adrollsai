import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { triggerVobizOutboundCall } from '@/utils/vobiz-helper'

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
        const { leadId, campaignId, toPhone, impersonate } = body

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

        if (!leadId && !toPhone) {
            return NextResponse.json({ error: 'leadId or toPhone is required' }, { status: 400 })
        }

        let targetLeadId = leadId
        let targetPhone = toPhone

        if (leadId) {
            const { data: lead } = await supabaseAdmin
                .from('leads')
                .select('id, phone, user_id')
                .eq('id', leadId)
                .single()

            if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
            targetPhone = lead.phone
            targetLeadId = lead.id
            if (!impersonateId && lead.user_id) {
                targetId = lead.user_id
            }
        }

        const result = await triggerVobizOutboundCall(supabaseAdmin, {
            leadId: targetLeadId,
            profileId: targetId,
            toPhone: targetPhone,
            campaignId
        })

        return NextResponse.json(result)
    } catch (err: any) {
        console.error('[VOBIZ CALL API] Error:', err)
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
    }
}
