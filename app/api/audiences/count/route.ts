import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

const supabaseAdmin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function normalizePhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '')
    return digits.length >= 10 ? digits.slice(-10) : digits
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
        const { filters, manualPhoneNumbers } = body || {}

        const {
            matchMode = 'OR',
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
                    .select('id, name, phone, email, source, ad_name, form_name, csv_audience, pipeline_stage, property_id, custom_fields, created_at')
                    .eq('user_id', targetId)
                    .range(p * pageSize, (p + 1) * pageSize - 1)
            )
        }

        const fetchResults = await Promise.all(fetchPromises)
        let allLeads: any[] = []
        for (const r of fetchResults) {
            if (r.data) allLeads = allLeads.concat(r.data)
        }

        const manualPhoneSet = new Set<string>()
        if (Array.isArray(manualPhoneNumbers) && manualPhoneNumbers.length > 0) {
            manualPhoneNumbers.forEach((p: string) => {
                const norm = normalizePhone(p)
                if (norm) manualPhoneSet.add(norm)
            })
        }

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

        const matchedLeads: any[] = []

        for (const lead of allLeads) {
            const leadPhoneNorm = normalizePhone(lead.phone || '')
            if (manualPhoneSet.size > 0 && leadPhoneNorm && manualPhoneSet.has(leadPhoneNorm)) {
                matchedLeads.push(lead)
            } else {
                const hasCampaigns = campaigns.length > 0
                const hasForms = forms.length > 0
                const hasSources = sources.length > 0
                const hasStages = pipelineStages.length > 0
                const hasProps = propertyIds.length > 0
                const hasCsvs = csvAudiences.length > 0
                const hasCategoryFilters = hasCampaigns || hasForms || hasSources || hasStages || hasProps || hasCsvs
                const hasDateFilters = minDate !== null || maxDate !== null
                const hasFilters = hasCategoryFilters || hasDateFilters

                if (!hasFilters && manualPhoneSet.size === 0) {
                    matchedLeads.push(lead)
                } else if (hasFilters) {
                    // Date boundary check
                    if (minDate && lead.created_at) {
                        if (new Date(lead.created_at) < minDate) continue
                    }
                    if (maxDate && lead.created_at) {
                        if (new Date(lead.created_at) > maxDate) continue
                    }

                    if (!hasCategoryFilters) {
                        matchedLeads.push(lead)
                        continue
                    }

                    // 1. Campaign match
                    let matchesCampaign = false
                    if (hasCampaigns) {
                        let leadCamp = lead.ad_name ? lead.ad_name.trim() : null
                        if (!leadCamp && lead.custom_fields) {
                            let cf = lead.custom_fields
                            if (typeof cf === 'string') {
                                try { cf = JSON.parse(cf) } catch (e) { cf = null }
                            }
                            leadCamp = cf?.lead_source_details?.trim() || cf?.meta_ad_origin?.campaign_name?.trim() || null
                        }
                        matchesCampaign = Boolean(leadCamp && campaigns.includes(leadCamp))
                    }

                    // 2. Form match
                    let matchesForm = false
                    if (hasForms) {
                        matchesForm = Boolean(lead.form_name && forms.includes(lead.form_name.trim()))
                    }

                    // 3. Source match
                    let matchesSource = false
                    if (hasSources) {
                        matchesSource = Boolean(lead.source && sources.includes(lead.source))
                    }

                    // 4. Stage match
                    let matchesStage = false
                    if (hasStages) {
                        matchesStage = Boolean(lead.pipeline_stage && pipelineStages.includes(lead.pipeline_stage))
                    }

                    // 5. Property match
                    let matchesProp = false
                    if (hasProps) {
                        matchesProp = Boolean(lead.property_id && propertyIds.includes(lead.property_id))
                    }

                    // 6. CSV Audience match
                    let matchesCsv = false
                    if (hasCsvs) {
                        const leadCsvs = (lead.csv_audience || '').split(',').map((s: string) => s.trim())
                        matchesCsv = csvAudiences.some((aud: string) => leadCsvs.includes(aud))
                    }

                    let isMatch = false
                    if (matchMode === 'OR') {
                        isMatch = (
                            (hasCampaigns && matchesCampaign) ||
                            (hasForms && matchesForm) ||
                            (hasSources && matchesSource) ||
                            (hasStages && matchesStage) ||
                            (hasProps && matchesProp) ||
                            (hasCsvs && matchesCsv)
                        )
                    } else {
                        isMatch = (
                            (!hasCampaigns || matchesCampaign) &&
                            (!hasForms || matchesForm) &&
                            (!hasSources || matchesSource) &&
                            (!hasStages || matchesStage) &&
                            (!hasProps || matchesProp) &&
                            (!hasCsvs || matchesCsv)
                        )
                    }

                    if (isMatch) {
                        matchedLeads.push(lead)
                    }
                }
            }
        }

        const count = matchedLeads.length
        // Return first 50 leads for UI inspection table
        const previewLeads = matchedLeads.slice(0, 50).map(l => {
            let camp = l.ad_name
            if (!camp && l.custom_fields) {
                let cf = l.custom_fields
                if (typeof cf === 'string') {
                    try { cf = JSON.parse(cf) } catch (e) {}
                }
                camp = cf?.lead_source_details || cf?.meta_ad_origin?.campaign_name
            }
            return {
                id: l.id,
                name: l.name || 'Unnamed Lead',
                phone: l.phone || '—',
                email: l.email || '—',
                source: l.source || '—',
                form: l.form_name || '—',
                campaign: camp || '—',
                stage: l.pipeline_stage || 'New',
                created_at: l.created_at
            }
        })

        return NextResponse.json({
            success: true,
            count,
            previewLeads
        })
    } catch (e: any) {
        console.error('Error evaluating audience count:', e)
        return NextResponse.json({ error: e.message || 'Failed to evaluate count' }, { status: 500 })
    }
}
