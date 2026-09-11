import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

const supabaseAdmin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// In-memory cache to make repeated calls instantaneous
const cacheMap = new Map<string, { timestamp: number; data: any }>()
const CACHE_TTL_MS = 90 * 1000 // 90 seconds cache

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        let user = null
        const authHeader = req.headers.get('Authorization')
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.substring(7)
            if (token === process.env.SUPABASE_SERVICE_ROLE_KEY) {
                user = { id: 'admin' }
            } else {
                const { data } = await supabaseAdmin.auth.getUser(token)
                user = data?.user
            }
        }
        if (!user) {
            const { data } = await supabase.auth.getUser()
            user = data?.user
        }
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        const impersonateId = url.searchParams.get('impersonate')
        const forceRefresh = url.searchParams.get('refresh') === 'true'

        let targetId = user.id
        if (impersonateId && impersonateId !== user.id) {
            if (user.id === 'admin') {
                targetId = impersonateId
            } else {
                const { data: authProfile } = await supabase
                    .from('profiles')
                    .select('role, agency_id, parent_id')
                    .eq('id', user.id)
                    .single()

                if (['super_admin', 'agency', 'admin', 'agent'].includes(authProfile?.role || '')) {
                    targetId = impersonateId
                }
            }
        }

        // Check cache if not forcing refresh
        const cacheKey = `metadata_${targetId}`
        if (!forceRefresh) {
            const cached = cacheMap.get(cacheKey)
            if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                return NextResponse.json({ success: true, ...cached.data, cached: true })
            }
        }

        // Fetch properties for target user
        const { data: properties } = await supabaseAdmin
            .from('properties')
            .select('id, title')
            .eq('user_id', targetId)
            .order('title', { ascending: true })

        // Fetch saved audience groups for target user from automations table
        const { data: audienceRows } = await supabaseAdmin
            .from('automations')
            .select('id, title, description, stats, created_at')
            .eq('user_id', targetId)
            .ilike('title', 'Audience-Group:%')

        const audienceGroups = (audienceRows || []).map(row => {
            let config: any = {}
            try {
                config = typeof row.description === 'string' ? JSON.parse(row.description) : (row.description || {})
            } catch (e) {
                config = {}
            }
            let stats: any = {}
            try {
                stats = typeof row.stats === 'string' ? JSON.parse(row.stats) : (row.stats || {})
            } catch (e) {
                stats = {}
            }
            const groupName = row.title.replace(/^Audience-Group:\s*/i, '').trim()
            return {
                id: row.id,
                name: groupName,
                description: config.description || '',
                filters: config.filters || {},
                leadCount: stats.lead_count ?? config.leadCount ?? 0,
                created_at: row.created_at,
                last_synced_at: stats.last_synced_at || row.created_at
            }
        })

        // Fetch total leads count for target user
        const { count: totalLeadsCount } = await supabaseAdmin
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', targetId)

        const totalCount = totalLeadsCount || 0

        // Fetch leads in parallel chunks to aggregate metadata across all rows
        const pageSize = 1000
        const numPages = Math.min(Math.ceil(totalCount / pageSize), 30) // up to 30,000 leads
        const promises = []

        for (let p = 0; p < numPages; p++) {
            promises.push(
                supabaseAdmin
                    .from('leads')
                    .select('ad_name, source, csv_audience, pipeline_stage, property_id, custom_fields')
                    .eq('user_id', targetId)
                    .range(p * pageSize, (p + 1) * pageSize - 1)
            )
        }

        const results = await Promise.all(promises)

        const campaignCounts = new Map<string, number>()
        const stageCounts = new Map<string, number>()
        const sourceCounts = new Map<string, number>()
        const csvCounts = new Map<string, number>()
        const propertyCounts = new Map<string, number>()

        for (const res of results) {
            if (!res.data) continue
            for (const l of res.data) {
                if (l.source) {
                    sourceCounts.set(l.source, (sourceCounts.get(l.source) || 0) + 1)
                }
                if (l.pipeline_stage) {
                    stageCounts.set(l.pipeline_stage, (stageCounts.get(l.pipeline_stage) || 0) + 1)
                }
                if (l.property_id) {
                    propertyCounts.set(l.property_id, (propertyCounts.get(l.property_id) || 0) + 1)
                }
                if (l.csv_audience) {
                    const parts = l.csv_audience.split(',').map((s: string) => s.trim()).filter(Boolean)
                    parts.forEach((p: string) => {
                        csvCounts.set(p, (csvCounts.get(p) || 0) + 1)
                    })
                }

                // Identify campaign name
                let camp = l.ad_name ? l.ad_name.trim() : null
                if (!camp && l.custom_fields) {
                    let cf = l.custom_fields
                    if (typeof cf === 'string') {
                        try { cf = JSON.parse(cf) } catch (e) { cf = null }
                    }
                    camp = cf?.lead_source_details?.trim() || cf?.meta_ad_origin?.campaign_name?.trim() || null
                }

                if (camp) {
                    campaignCounts.set(camp, (campaignCounts.get(camp) || 0) + 1)
                }
            }
        }

        // Format sorted campaign list
        const campaignsList = Array.from(campaignCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)

        const sourcesList = Array.from(sourceCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)

        const stagesList = Array.from(stageCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)

        const csvList = Array.from(csvCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)

        const responseData = {
            totalLeads: totalCount,
            campaigns: campaignsList,
            campaignNames: campaignsList.map(c => c.name),
            sources: sourcesList,
            sourceNames: sourcesList.map(s => s.name),
            stages: stagesList,
            stageNames: stagesList.map(s => s.name),
            csvAudiences: csvList,
            csvAudienceNames: csvList.map(c => c.name),
            properties: (properties || []).map(p => ({
                id: p.id,
                title: p.title,
                count: propertyCounts.get(p.id) || 0
            })),
            audienceGroups
        }

        // Cache result
        cacheMap.set(cacheKey, { timestamp: Date.now(), data: responseData })

        return NextResponse.json({ success: true, ...responseData, cached: false })
    } catch (e: any) {
        console.error('Error fetching CRM audiences metadata:', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
