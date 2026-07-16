import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const supabaseAdmin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        let impersonateId = url.searchParams.get('impersonate')

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

        // Fetch campaigns using the server-side admin client (bypassing client RLS policies if impersonating)
        const { data: campaigns, error } = await supabaseAdmin
            .from('voice_campaigns')
            .select('*')
            .eq('user_id', targetId)
            .order('created_at', { ascending: false })

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Fetch real-time stats directly from the database for each campaign
        const campaignsWithStats = []
        if (campaigns && campaigns.length > 0) {
            for (const c of campaigns) {
                const { count: totalCount } = await supabaseAdmin
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .eq('voice_campaign_id', c.id)

                const { count: spokeCount } = await supabaseAdmin
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .eq('voice_campaign_id', c.id)
                    .eq('voice_call_status', 'completed')

                const { count: unreachableCount } = await supabaseAdmin
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .eq('voice_campaign_id', c.id)
                    .in('voice_call_status', ['failed', 'failed_max_retries'])

                const { count: dialingCount } = await supabaseAdmin
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .eq('voice_campaign_id', c.id)
                    .eq('voice_call_status', 'calling')

                const { count: queueCount } = await supabaseAdmin
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .eq('voice_campaign_id', c.id)
                    .or('voice_call_status.is.null,voice_call_status.eq.not_called,voice_call_status.eq.scheduled_retry')

                campaignsWithStats.push({
                    ...c,
                    stats: {
                        total: totalCount || 0,
                        spoke: spokeCount || 0,
                        unreachable: unreachableCount || 0,
                        dialing: dialingCount || 0,
                        queue: queueCount || 0
                    }
                })
            }
        }

        return NextResponse.json({ success: true, campaigns: campaignsWithStats })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await req.json()
        const { name, audience_filter, custom_prompt, impersonate } = body

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

        // Insert campaign using the admin client to bypass RLS restrictions
        const { data: campaign, error } = await supabaseAdmin
            .from('voice_campaigns')
            .insert({
                user_id: targetId,
                name,
                audience_filter,
                custom_prompt,
                status: 'draft'
            })
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, campaign })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function PATCH(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await req.json()
        const { campaignId, status, impersonate } = body

        if (!campaignId || !status) {
            return NextResponse.json({ error: 'Missing campaignId or status' }, { status: 400 })
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

        // Update campaign status using the admin client to bypass RLS restrictions
        const { data: campaign, error } = await supabaseAdmin
            .from('voice_campaigns')
            .update({ status })
            .eq('id', campaignId)
            .eq('user_id', targetId)
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, campaign })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
