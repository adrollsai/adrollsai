import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
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
        const { campaignId, impersonate } = body
        if (!campaignId) return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })

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

        // Fetch campaign details using admin client to bypass RLS select policy
        const { data: campaign, error: campErr } = await supabaseAdmin
            .from('voice_campaigns')
            .select('*')
            .eq('id', campaignId)
            .eq('user_id', targetId)
            .single()

        if (campErr || !campaign) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
        }

        // Fetch all leads of the user using admin client to bypass RLS select policy
        const { data: leads, error: leadsErr } = await supabaseAdmin
            .from('leads')
            .select('id, phone, source, pipeline_stage, campaign_id, ad_name, csv_audience, custom_fields, created_at')
            .eq('user_id', targetId)
            .order('created_at', { ascending: false })

        if (leadsErr || !leads) {
            console.error('[CAMPAIGN START] leads query error:', leadsErr)
            return NextResponse.json({ error: 'Failed to query leads for campaign: ' + (leadsErr?.message || 'Unknown') }, { status: 500 })
        }

        // Fetch campaigns to map campaign_id to campaign names
        const { data: dbCampaigns } = await supabaseAdmin
            .from('campaigns')
            .select('id, name')
            .eq('user_id', targetId)

        // Apply advanced hybrid multi-audience filters
        const filter = campaign.audience_filter || {}
        const filteredLeads = leads.filter(lead => {
            // 1. Check pipeline stages
            if (filter.pipeline_stages && filter.pipeline_stages.length > 0) {
                if (!filter.pipeline_stages.includes(lead.pipeline_stage || 'New')) {
                    return false
                }
            }

            // 2. Check sources, meta campaigns, and CSV audiences
            const hasSources = filter.sources && filter.sources.length > 0
            const hasMeta = filter.meta_campaigns && filter.meta_campaigns.length > 0
            const hasCsv = filter.csv_audiences && filter.csv_audiences.length > 0

            if (hasSources || hasMeta || hasCsv) {
                let match = false
                if (hasSources && lead.source && filter.sources.includes(lead.source)) {
                    match = true
                }
                if (hasMeta) {
                    const customFieldsStr = typeof lead.custom_fields === 'string' 
                        ? lead.custom_fields 
                        : JSON.stringify(lead.custom_fields || {});

                    for (const targetMeta of filter.meta_campaigns) {
                        if (!targetMeta) continue;
                        const targetLower = String(targetMeta).toLowerCase();
                        
                        if (lead.campaign_id && (lead.campaign_id === targetMeta || String(lead.campaign_id).toLowerCase() === targetLower)) {
                            match = true;
                            break;
                        }
                        if (lead.ad_name && (lead.ad_name === targetMeta || lead.ad_name.toLowerCase().includes(targetLower) || targetLower.includes(lead.ad_name.toLowerCase()))) {
                            match = true;
                            break;
                        }
                        if (customFieldsStr.toLowerCase().includes(targetLower)) {
                            match = true;
                            break;
                        }
                        if (lead.campaign_id) {
                            const campName = dbCampaigns?.find(c => c.id === lead.campaign_id)?.name;
                            if (campName && (campName === targetMeta || campName.toLowerCase().includes(targetLower))) {
                                match = true;
                                break;
                            }
                        }
                    }

                    // Fallback: If filter.meta_campaigns is non-empty and lead source is Meta/Facebook/WhatsApp, match lead
                    if (!match && lead.source && /facebook|meta|whatsapp/i.test(lead.source)) {
                        match = true;
                    }
                }
                if (hasCsv && lead.csv_audience && filter.csv_audiences.includes(lead.csv_audience)) {
                    match = true
                }
                if (!match) return false
            }

            return true
        })

        const targetLeads = filteredLeads.filter(l => l.phone)
        if (targetLeads.length === 0) {
            return NextResponse.json({ error: 'No contacts found matching the target audience filters.' }, { status: 400 })
        }

        // Set campaign status to running using admin client
        await supabaseAdmin
            .from('voice_campaigns')
            .update({ status: 'running' })
            .eq('id', campaignId)

        // Assign voice_campaign_id in bulk using admin client (in batches of 100 to avoid URI too long gateway issues)
        const batchSize = 100
        for (let i = 0; i < targetLeads.length; i += batchSize) {
            const batchIds = targetLeads.slice(i, i + batchSize).map(l => l.id)
            const { error: updateErr } = await supabaseAdmin
                .from('leads')
                .update({ voice_campaign_id: campaignId })
                .in('id', batchIds)
            
            if (updateErr) {
                console.error(`[CAMPAIGN START] Failed to assign campaign to batch ${i}:`, updateErr)
            }
        }

        // Trigger calls sequentially in background using admin client
        const { dispatchNextCall } = require('@/utils/voice-helper')
        dispatchNextCall(supabaseAdmin, targetId).catch((runErr: any) => {
            console.error('[CAMPAIGN ASYNC RUNNER ERROR]', runErr)
        })

        return NextResponse.json({
            success: true,
            totalLeads: targetLeads.length,
            message: `Campaign started. Initiating calls to ${targetLeads.length} leads.`
        })

    } catch (e: any) {
        console.error('[CAMPAIGN START ERROR]', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
