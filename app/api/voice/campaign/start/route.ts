import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { triggerOutboundCall } from '@/utils/voice-helper'

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { campaignId } = await req.json()
        if (!campaignId) return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })

        // Fetch campaign details
        const { data: campaign, error: campErr } = await supabase
            .from('voice_campaigns')
            .select('*')
            .eq('id', campaignId)
            .eq('user_id', user.id)
            .single()

        if (campErr || !campaign) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
        }

        // Fetch all leads of the user
        const { data: leads, error: leadsErr } = await supabase
            .from('leads')
            .select('id, phone, source, pipeline_stage, campaign_name, ad_name, csv_audience')
            .eq('user_id', user.id)

        if (leadsErr || !leads) {
            return NextResponse.json({ error: 'Failed to query leads for campaign' }, { status: 500 })
        }

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
                if (hasMeta && (filter.meta_campaigns.includes(lead.campaign_name) || filter.meta_campaigns.includes(lead.ad_name))) {
                    match = true
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

        // Set campaign status to running
        await supabase
            .from('voice_campaigns')
            .update({ status: 'running' })
            .eq('id', campaignId)

        // Assign voice_campaign_id in bulk
        await supabase
            .from('leads')
            .update({ voice_campaign_id: campaignId })
            .in('id', targetLeads.map(l => l.id))

        // Trigger calls sequentially in background
        const { dispatchNextCall } = require('@/utils/voice-helper')
        dispatchNextCall(supabase, user.id).catch((runErr: any) => {
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
