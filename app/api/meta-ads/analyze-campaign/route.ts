import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { analyzeCampaignWithDeepSeek } from '@/utils/campaign-analyzer'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

// Admin client to bypass RLS when performing service tasks
const getAdminClient = () => {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

// Helper to resolve target user and meta token
async function resolveCredentials(supabase: any, impersonateId: string | null) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, facebook_token, ad_account_id, agency_id, parent_id')
        .eq('id', user.id)
        .single()

    let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id))
        ? (profile.agency_id || profile.parent_id)
        : user.id

    if (impersonateId) {
        if (['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
            if (profile?.role !== 'super_admin') {
                const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId)
                const { data: subAccount } = await supabase
                    .from('profiles')
                    .select('id')
                    .eq('id', impersonateId)
                    .eq('agency_id', profile?.agency_id || user.id)
                    .single()

                if (isParent || subAccount) {
                    targetUserId = impersonateId
                }
            } else {
                targetUserId = impersonateId
            }
        }
    }

    const { data: targetProfile } = await getAdminClient()
        .from('profiles')
        .select('facebook_token, ad_account_id, selected_page_token, selected_page_id, business_name, currency')
        .eq('id', targetUserId)
        .single()

    const token = targetProfile?.facebook_token || profile?.facebook_token || null
    return {
        userId: user.id,
        targetUserId,
        token,
        adAccountId: targetProfile?.ad_account_id || null,
        pageId: targetProfile?.selected_page_id || null,
        businessName: targetProfile?.business_name || 'Our Business',
        currency: targetProfile?.currency || 'INR'
    }
}

// GET: Retrieve past analyses for this campaign
export async function GET(request: Request) {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaignId')
    const impersonateId = searchParams.get('impersonate')

    if (!campaignId) {
        return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
    }

    const creds = await resolveCredentials(supabase, impersonateId)
    if (!creds) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const supabaseAdmin = getAdminClient()
        const { data, error } = await supabaseAdmin
            .from('campaign_analyses')
            .select('*')
            .eq('campaign_id', campaignId)
            .eq('user_id', creds.targetUserId)
            .order('created_at', { ascending: false })

        if (error) throw error

        return NextResponse.json({ success: true, history: data || [] })
    } catch (e: any) {
        console.error("[GET Campaign Analysis] Error:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

// POST: Run live analysis with DeepSeek Flash and save it
export async function POST(request: Request) {
    const supabase = await createClient()
    const { campaignId, impersonateId } = await request.json()

    if (!campaignId) {
        return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
    }

    const creds = await resolveCredentials(supabase, impersonateId)
    if (!creds || !creds.token || !creds.adAccountId) {
        return NextResponse.json({ error: 'Meta Ad Account not fully connected.' }, { status: 400 })
    }

    const supabaseAdmin = getAdminClient()

    try {
        const result = await analyzeCampaignWithDeepSeek({
            campaignId,
            token: creds.token,
            targetUserId: creds.targetUserId,
            businessName: creds.businessName,
            currency: creds.currency,
            supabaseAdmin
        })

        if (!result.success) {
            return NextResponse.json({ error: result.error || 'Analysis failed' }, { status: 400 })
        }

        return NextResponse.json({
            success: true,
            analysis: result.analysis
        })
    } catch (e: any) {
        console.error("[POST Campaign Analysis] Error:", e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
