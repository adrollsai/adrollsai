import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

const supabaseAdmin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper to normalize phone digits
function normalizePhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '')
    return digits.length >= 10 ? digits.slice(-10) : digits
}

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

        // Fetch audience groups from automations table
        const { data: rows, error } = await supabaseAdmin
            .from('automations')
            .select('*')
            .eq('user_id', targetId)
            .ilike('title', 'Audience-Group:%')
            .order('created_at', { ascending: false })

        if (error) throw error

        const audiences = (rows || []).map(row => {
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

            const cleanName = row.title.replace(/^Audience-Group:\s*/i, '').trim()

            return {
                id: row.id,
                name: cleanName,
                description: config.description || '',
                filters: config.filters || {},
                leadCount: stats.lead_count ?? config.leadCount ?? 0,
                is_active: row.is_active !== false,
                created_at: row.created_at,
                last_synced_at: stats.last_synced_at || row.created_at
            }
        })

        return NextResponse.json({ success: true, audiences })
    } catch (e: any) {
        console.error('Error fetching audiences:', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
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

        const body = await req.json()
        const { id: existingId, name, description, filters, manualPhoneNumbers } = body

        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json({ error: 'Audience group name is required.' }, { status: 400 })
        }

        const cleanName = name.trim()
        const audienceTitle = `Audience-Group: ${cleanName}`

        // Extract filters
        const {
            campaigns = [],
            forms = [],
            sources = [],
            pipelineStages = [],
            propertyIds = [],
            csvAudiences = [],
            dateRange = 'all',
            startDate = null,
            endDate = null
        } = filters || {}

        // 1. Fetch total leads for target user to prepare batch pagination
        const { count: totalLeadsCount } = await supabaseAdmin
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', targetId)

        const totalCount = totalLeadsCount || 0
        const pageSize = 1000
        const numPages = Math.min(Math.ceil(totalCount / pageSize), 30) // up to 30,000 leads
        const fetchPromises = []

        for (let p = 0; p < numPages; p++) {
            fetchPromises.push(
                supabaseAdmin
                    .from('leads')
                    .select('id, name, phone, source, ad_name, form_name, csv_audience, pipeline_stage, property_id, custom_fields, created_at')
                    .eq('user_id', targetId)
                    .range(p * pageSize, (p + 1) * pageSize - 1)
            )
        }

        const fetchResults = await Promise.all(fetchPromises)
        let allLeads: any[] = []
        for (const r of fetchResults) {
            if (r.data) allLeads = allLeads.concat(r.data)
        }

        // 2. Prepare manual phone numbers set if provided
        const manualPhoneSet = new Set<string>()
        if (Array.isArray(manualPhoneNumbers) && manualPhoneNumbers.length > 0) {
            manualPhoneNumbers.forEach((p: string) => {
                const norm = normalizePhone(p)
                if (norm) manualPhoneSet.add(norm)
            })
        }

        // 3. Date range threshold
        let minDate: Date | null = null
        let maxDate: Date | null = null
        if (dateRange === '7d') {
            minDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        } else if (dateRange === '30d') {
            minDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        } else if (dateRange === '90d') {
            minDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        } else if (dateRange === 'custom') {
            if (startDate) {
                const d = new Date(startDate)
                if (!isNaN(d.getTime())) {
                    d.setHours(0, 0, 0, 0)
                    minDate = d
                }
            }
            if (endDate) {
                const d = new Date(endDate)
                if (!isNaN(d.getTime())) {
                    d.setHours(23, 59, 59, 999)
                    maxDate = d
                }
            }
        }

        // 4. Filter matching leads
        const matchedLeadIds = new Set<string>()
        const leadsToTag: { id: string; csv_audience: string; custom_fields: any }[] = []

        for (const lead of allLeads) {
            // Check manual phones first
            const leadPhoneNorm = normalizePhone(lead.phone || '')
            if (manualPhoneSet.size > 0 && leadPhoneNorm && manualPhoneSet.has(leadPhoneNorm)) {
                matchedLeadIds.add(lead.id)
            } else {
                // If filters are applied, test criteria
                const hasFilters = campaigns.length > 0 || forms.length > 0 || sources.length > 0 || pipelineStages.length > 0 || propertyIds.length > 0 || csvAudiences.length > 0 || minDate !== null || maxDate !== null

                if (!hasFilters && manualPhoneSet.size === 0) {
                    // No filters and no manual phones means include all leads
                    matchedLeadIds.add(lead.id)
                } else if (hasFilters) {
                    // Date range test
                    if (minDate && lead.created_at) {
                        if (new Date(lead.created_at) < minDate) continue
                    }

                    if (maxDate && lead.created_at) {
                        if (new Date(lead.created_at) > maxDate) continue
                    }

                    // Source test
                    if (sources.length > 0) {
                        if (!lead.source || !sources.includes(lead.source)) continue
                    }

                    // Form test
                    if (forms.length > 0) {
                        if (!lead.form_name || !forms.includes(lead.form_name.trim())) continue
                    }

                    // Stage test
                    if (pipelineStages.length > 0) {
                        if (!lead.pipeline_stage || !pipelineStages.includes(lead.pipeline_stage)) continue
                    }

                    // Property test
                    if (propertyIds.length > 0) {
                        if (!lead.property_id || !propertyIds.includes(lead.property_id)) continue
                    }

                    // CSV audience test
                    if (csvAudiences.length > 0) {
                        const leadCsvs = (lead.csv_audience || '').split(',').map((s: string) => s.trim())
                        const matchesCsv = csvAudiences.some((aud: string) => leadCsvs.includes(aud))
                        if (!matchesCsv) continue
                    }

                    // Campaign test (searches ad_name and custom_fields)
                    if (campaigns.length > 0) {
                        let leadCamp = lead.ad_name ? lead.ad_name.trim() : null
                        if (!leadCamp && lead.custom_fields) {
                            let cf = lead.custom_fields
                            if (typeof cf === 'string') {
                                try { cf = JSON.parse(cf) } catch (e) { cf = null }
                            }
                            leadCamp = cf?.lead_source_details?.trim() || cf?.meta_ad_origin?.campaign_name?.trim() || null
                        }

                        if (!leadCamp || !campaigns.includes(leadCamp)) continue
                    }

                    matchedLeadIds.add(lead.id)
                }
            }

            // If lead is matched, prepare tag updates
            if (matchedLeadIds.has(lead.id)) {
                let currentCsv = lead.csv_audience || ''
                let updatedCsv = currentCsv
                if (!currentCsv) {
                    updatedCsv = cleanName
                } else if (!currentCsv.includes(cleanName)) {
                    updatedCsv = `${currentCsv}, ${cleanName}`
                }

                let cf = lead.custom_fields || {}
                if (typeof cf === 'string') {
                    try { cf = JSON.parse(cf) } catch (e) { cf = {} }
                }
                const groups: string[] = Array.isArray(cf.audience_groups)
                    ? [...cf.audience_groups]
                    : (cf.audience_groups ? [cf.audience_groups] : [])

                if (!groups.includes(cleanName)) {
                    groups.push(cleanName)
                }
                cf.audience_groups = groups

                if (updatedCsv !== currentCsv || !Array.isArray(lead.custom_fields?.audience_groups) || !lead.custom_fields.audience_groups.includes(cleanName)) {
                    leadsToTag.push({
                        id: lead.id,
                        csv_audience: updatedCsv,
                        custom_fields: cf
                    })
                }
            }
        }

        // 5. Batch update leads with audience group tag
        const TAG_BATCH = 50
        for (let i = 0; i < leadsToTag.length; i += TAG_BATCH) {
            const chunk = leadsToTag.slice(i, i + TAG_BATCH)
            await Promise.all(chunk.map(item => 
                supabaseAdmin
                    .from('leads')
                    .update({
                        csv_audience: item.csv_audience,
                        custom_fields: item.custom_fields
                    })
                    .eq('id', item.id)
            ))
        }

        const finalLeadCount = matchedLeadIds.size

        // 6. Save audience group record in automations table
        const audienceConfig = {
            name: cleanName,
            description: description || '',
            filters: {
                campaigns,
                forms,
                sources,
                pipelineStages,
                propertyIds,
                csvAudiences,
                dateRange,
                startDate,
                endDate
            },
            leadCount: finalLeadCount,
            lastSyncedAt: new Date().toISOString()
        }

        let savedRecord = null
        if (existingId) {
            const { data, error } = await supabaseAdmin
                .from('automations')
                .update({
                    title: audienceTitle,
                    description: JSON.stringify(audienceConfig),
                    stats: JSON.stringify({ lead_count: finalLeadCount, last_synced_at: new Date().toISOString() }),
                    is_active: true
                })
                .eq('id', existingId)
                .select()
                .single()

            if (error) throw error
            savedRecord = data
        } else {
            // Check if audience with same title exists
            const { data: existingGroup } = await supabaseAdmin
                .from('automations')
                .select('id')
                .eq('user_id', targetId)
                .eq('title', audienceTitle)
                .maybeSingle()

            if (existingGroup?.id) {
                const { data, error } = await supabaseAdmin
                    .from('automations')
                    .update({
                        description: JSON.stringify(audienceConfig),
                        stats: JSON.stringify({ lead_count: finalLeadCount, last_synced_at: new Date().toISOString() }),
                        is_active: true
                    })
                    .eq('id', existingGroup.id)
                    .select()
                    .single()

                if (error) throw error
                savedRecord = data
            } else {
                const { data, error } = await supabaseAdmin
                    .from('automations')
                    .insert({
                        user_id: targetId,
                        title: audienceTitle,
                        description: JSON.stringify(audienceConfig),
                        icon_name: 'Users',
                        is_active: true,
                        stats: JSON.stringify({ lead_count: finalLeadCount, last_synced_at: new Date().toISOString() })
                    })
                    .select()
                    .single()

                if (error) throw error
                savedRecord = data
            }
        }

        return NextResponse.json({
            success: true,
            message: `Audience group "${cleanName}" saved with ${finalLeadCount} leads.`,
            audience: {
                id: savedRecord.id,
                name: cleanName,
                description: description || '',
                filters: audienceConfig.filters,
                leadCount: finalLeadCount,
                created_at: savedRecord.created_at,
                last_synced_at: new Date().toISOString()
            }
        })
    } catch (e: any) {
        console.error('Error saving audience group:', e)
        return NextResponse.json({ error: e.message || 'Failed to save audience group' }, { status: 500 })
    }
}

export async function DELETE(req: Request) {
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
        const id = url.searchParams.get('id')
        if (!id) return NextResponse.json({ error: 'Audience ID is required' }, { status: 400 })

        const { error } = await supabaseAdmin
            .from('automations')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true, message: 'Audience group deleted successfully' })
    } catch (e: any) {
        console.error('Error deleting audience group:', e)
        return NextResponse.json({ error: e.message || 'Failed to delete audience group' }, { status: 500 })
    }
}
