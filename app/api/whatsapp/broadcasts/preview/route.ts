import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function cleanPhoneNumber(rawPhone: string): string {
    const digits = (rawPhone || '').replace(/\D/g, '')
    if (!digits) return ''
    if (digits.length === 10) return '91' + digits
    return digits
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await req.json().catch(() => ({}))
        const {
            audienceFilter,
            recipientStage,
            recipientPropertyId,
            recipientCsvAudience,
            impersonateId
        } = body

        const targetUserId = impersonateId || user.id

        // Fetch user leads with batch pagination
        const { count: totalLeadsCount } = await supabaseAdmin
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', targetUserId)

        const totalUserLeads = totalLeadsCount || 0
        const pageSize = 1000
        const numPages = Math.min(Math.ceil(totalUserLeads / pageSize), 30) // up to 30k
        const fetchPromises = []

        for (let p = 0; p < numPages; p++) {
            fetchPromises.push(
                supabaseAdmin
                    .from('leads')
                    .select('id, name, phone, source, ad_name, csv_audience, pipeline_stage, property_id, custom_fields, created_at')
                    .eq('user_id', targetUserId)
                    .range(p * pageSize, (p + 1) * pageSize - 1)
            )
        }

        const fetchResults = await Promise.all(fetchPromises)
        let allUserLeads: any[] = []
        for (const r of fetchResults) {
            if (r.data) allUserLeads = allUserLeads.concat(r.data)
        }

        // Apply broadcast filters matching backend execution exactly
        const matchingLeads = allUserLeads.filter(lead => {
            if (audienceFilter) {
                // Saved Audience Group
                if (audienceFilter.targetType === 'audience_group') {
                    const groupName = audienceFilter.audienceGroupName || ''
                    if (!groupName) return false
                    const csvList = (lead.csv_audience || '').split(',').map((s: string) => s.trim())
                    let cf = lead.custom_fields
                    if (typeof cf === 'string') {
                        try { cf = JSON.parse(cf) } catch (e) { cf = {} }
                    }
                    const groups = Array.isArray(cf?.audience_groups) ? cf.audience_groups : (cf?.audience_groups ? [cf.audience_groups] : [])
                    return csvList.includes(groupName) || groups.includes(groupName)
                }

                // Custom multi-filter target
                if (audienceFilter.targetType === 'custom') {
                    const { csvAudiences, sources, metaCampaigns, pipelineStages, propertyIds } = audienceFilter

                    if (csvAudiences && Array.isArray(csvAudiences) && csvAudiences.length > 0) {
                        const csvList = (lead.csv_audience || '').split(',').map((s: string) => s.trim())
                        const matchesCsv = csvAudiences.some((aud: string) => csvList.includes(aud))
                        if (!matchesCsv) return false
                    }

                    if (sources && Array.isArray(sources) && sources.length > 0) {
                        if (!lead.source || !sources.includes(lead.source)) return false
                    }

                    if (pipelineStages && Array.isArray(pipelineStages) && pipelineStages.length > 0) {
                        if (!lead.pipeline_stage || !pipelineStages.includes(lead.pipeline_stage)) return false
                    }

                    if (propertyIds && Array.isArray(propertyIds) && propertyIds.length > 0) {
                        if (!lead.property_id || !propertyIds.includes(lead.property_id)) return false
                    }

                    if (metaCampaigns && Array.isArray(metaCampaigns) && metaCampaigns.length > 0) {
                        let camp = lead.ad_name ? lead.ad_name.trim() : null
                        if (!camp && lead.custom_fields) {
                            let cf = lead.custom_fields
                            if (typeof cf === 'string') {
                                try { cf = JSON.parse(cf) } catch (e) { cf = null }
                            }
                            camp = cf?.lead_source_details?.trim() || cf?.meta_ad_origin?.campaign_name?.trim() || null
                        }
                        if (!camp || !metaCampaigns.includes(camp)) return false
                    }

                    return true
                }
            }

            // Basic legacy filters
            if (recipientStage && recipientStage !== 'All') {
                if (lead.pipeline_stage !== recipientStage) return false
            }

            if (recipientPropertyId) {
                if (lead.property_id !== recipientPropertyId) return false
            }

            if (recipientCsvAudience) {
                const csvList = (lead.csv_audience || '').split(',').map((s: string) => s.trim())
                if (!csvList.includes(recipientCsvAudience)) return false
            }

            return true
        })

        let validPhoneCount = 0
        let missingPhoneCount = 0

        const previewLeads = []

        for (const lead of matchingLeads) {
            const rawPhone = lead.phone || lead.custom_fields?.whatsapp_number || lead.custom_fields?.phone_number || ''
            const cleanPhone = cleanPhoneNumber(rawPhone)

            if (cleanPhone && cleanPhone.length >= 10) {
                validPhoneCount++
            } else {
                missingPhoneCount++
            }

            if (previewLeads.length < 20) {
                let camp = lead.ad_name
                if (!camp && lead.custom_fields) {
                    let cf = lead.custom_fields
                    if (typeof cf === 'string') {
                        try { cf = JSON.parse(cf) } catch (e) { }
                    }
                    camp = cf?.lead_source_details || cf?.meta_ad_origin?.campaign_name
                }

                previewLeads.push({
                    id: lead.id,
                    name: lead.name || 'Unnamed Contact',
                    phone: lead.phone || 'No phone',
                    formattedPhone: cleanPhone || 'Invalid',
                    hasValidPhone: !!(cleanPhone && cleanPhone.length >= 10),
                    stage: lead.pipeline_stage || 'New',
                    source: lead.source || 'Direct',
                    campaign: camp || '—'
                })
            }
        }

        return NextResponse.json({
            success: true,
            totalMatching: matchingLeads.length,
            validPhoneCount,
            missingPhoneCount,
            sampleLeads: previewLeads
        })
    } catch (e: any) {
        console.error('[AUDIENCE PREVIEW ERROR]', e)
        return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
    }
}
