import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(req.url)
        const duration = url.searchParams.get('duration') || '30d'
        const filterAgentId = url.searchParams.get('agentId')
        const impersonateId = url.searchParams.get('impersonate')

        // Fetch current session user's profile
        const { data: myProfile } = await supabaseAdmin
            .from('profiles')
            .select('id, role, parent_id, agency_id, business_name, full_name, email')
            .eq('id', user.id)
            .single()

        const myRole = myProfile?.role?.toLowerCase() || 'admin'
        const isTeamUser = !!(myProfile?.parent_id || myProfile?.agency_id || myRole === 'agent' || myRole === 'team_member')

        // Determine target workspace owner ID
        let targetOwnerId = user.id
        if (impersonateId && impersonateId !== 'null' && impersonateId !== 'undefined' && impersonateId !== user.id) {
            targetOwnerId = impersonateId
        } else if (isTeamUser && (myProfile?.parent_id || myProfile?.agency_id)) {
            targetOwnerId = myProfile.parent_id || myProfile.agency_id || user.id
        }

        // Determine active agent filter
        let activeAgentId = (filterAgentId && filterAgentId !== 'null' && filterAgentId !== 'undefined') ? filterAgentId : null
        if (isTeamUser) {
            activeAgentId = user.id
        }

        // Calculate date range
        const now = new Date()
        let startDate: Date | null = null
        let endDate: Date | null = null

        const startDateParam = url.searchParams.get('startDate')
        const endDateParam = url.searchParams.get('endDate')
        const customDateParam = url.searchParams.get('customDate')

        if (customDateParam && customDateParam !== 'null' && customDateParam !== 'undefined') {
            startDate = new Date(customDateParam)
            startDate.setHours(0, 0, 0, 0)
            endDate = new Date(customDateParam)
            endDate.setHours(23, 59, 59, 999)
        } else if (startDateParam && startDateParam !== 'null' && startDateParam !== 'undefined') {
            startDate = new Date(startDateParam)
            startDate.setHours(0, 0, 0, 0)
            if (endDateParam && endDateParam !== 'null' && endDateParam !== 'undefined') {
                endDate = new Date(endDateParam)
                endDate.setHours(23, 59, 59, 999)
            }
        } else {
            switch (duration) {
                case 'today':
                    startDate = new Date()
                    startDate.setHours(0, 0, 0, 0)
                    break
                case '7d':
                    startDate = new Date()
                    startDate.setDate(now.getDate() - 7)
                    break
                case '30d':
                    startDate = new Date()
                    startDate.setDate(now.getDate() - 30)
                    break
                case 'this_month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1)
                    break
                case 'last_month':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
                    break
                case 'all':
                default:
                    startDate = null
                    break
            }
        }

        // 1. Fetch CRM Leads with ONLY required fields and date filters applied at DB level
        let finalLeads: any[] = []
        let page = 0
        const pageSize = 1000

        // Determine workspace team profile IDs if workspace admin
        let workspaceOwnerTeamIds: string[] = [targetOwnerId]
        const { data: workspaceTeamProfiles } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)

        if (workspaceTeamProfiles && workspaceTeamProfiles.length > 0) {
            workspaceOwnerTeamIds = Array.from(new Set(workspaceTeamProfiles.map(p => p.id)))
        }

        const leadFields = 'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, facebook_lead_id, external_id, summary, value, next_followup, assigned_to, budget, timeline, priority_status, facebook_created_at, form_id, form_name, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience'

        while (true) {
            let leadsQuery = supabaseAdmin
                .from('leads')
                .select(leadFields)
                .range(page * pageSize, (page + 1) * pageSize - 1)
                .order('created_at', { ascending: false })

            if (isTeamUser && activeAgentId) {
                leadsQuery = leadsQuery.or(`assigned_to.eq.${activeAgentId},user_id.eq.${activeAgentId}`)
            } else if (activeAgentId) {
                leadsQuery = leadsQuery.or(`assigned_to.eq.${activeAgentId},user_id.eq.${activeAgentId}`)
            } else {
                leadsQuery = leadsQuery.or(`user_id.in.(${workspaceOwnerTeamIds.join(',')}),assigned_to.in.(${workspaceOwnerTeamIds.join(',')})`)
            }

            if (startDate) {
                leadsQuery = leadsQuery.gte('created_at', startDate.toISOString())
            }
            if (endDate) {
                leadsQuery = leadsQuery.lte('created_at', endDate.toISOString())
            }

            const { data: pageLeads, error: leadsErr } = await leadsQuery
            if (leadsErr) {
                console.error("[Analytics API] Leads fetch error:", leadsErr)
                break
            }

            if (!pageLeads || pageLeads.length === 0) break
            
            // Safely parse custom_fields if stringified
            const parsedBatch = pageLeads.map(lead => {
                let cf = lead.custom_fields
                if (cf && typeof cf === 'string') {
                    try {
                        while (typeof cf === 'string') cf = JSON.parse(cf)
                    } catch (e) {
                        cf = {}
                    }
                }
                return { ...lead, custom_fields: cf || {} }
            })

            finalLeads.push(...parsedBatch)
            if (pageLeads.length < pageSize) break
            page++
        }

        // 2. Fetch Team Profiles for team matrix
        const { data: teamMembers } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, full_name, role, created_at')
            .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)
            .order('created_at', { ascending: false })

        const rawTeamMembers = teamMembers || []
        const safeTeamMembers = isTeamUser ? rawTeamMembers.filter(m => m.id === user.id) : rawTeamMembers

        const teamData = safeTeamMembers.map(member => {
            const memberLeads = finalLeads.filter(l => l.assigned_to === member.id || l.user_id === member.id)
            const wonLeads = memberLeads.filter(l => ['Won', 'Closed', 'Appointment done'].includes(l.pipeline_stage)).length
            const qualifiedLeads = memberLeads.filter(l => ['Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Won'].includes(l.pipeline_stage)).length
            const lostLeads = memberLeads.filter(l => ['Lost', 'Unqualified'].includes(l.pipeline_stage)).length
            
            const memberCallCount = memberLeads.filter(l => l.last_called_by === member.id || l.last_call_at || l.last_call_status).length
            const totalDnpOnLeads = memberLeads.reduce((acc, l) => {
                const count = l.dnp_count || l.custom_fields?.dnp_count || 0
                return acc + count
            }, 0)

            const conversionRate = memberLeads.length > 0 ? ((qualifiedLeads / memberLeads.length) * 100).toFixed(1) : '0.0'

            return {
                id: member.id,
                email: member.email,
                business_name: member.business_name || member.full_name || member.email,
                role: member.role,
                metrics: {
                    leadsCount: memberLeads.length,
                    wonCount: wonLeads,
                    qualifiedCount: qualifiedLeads,
                    lostCount: lostLeads,
                    callsCount: memberCallCount,
                    dnpCount: totalDnpOnLeads,
                    conversionRate
                }
            }
        })

        return NextResponse.json({
            success: true,
            duration,
            workspaceOwnerId: targetOwnerId,
            myRole,
            leads: finalLeads,
            chats: [],
            messages: [],
            history: [],
            team: teamData
        })

    } catch (e: any) {
        console.error('[Analytics API error]:', e)
        return NextResponse.json({ success: false, error: e.message || 'Internal Server Error' }, { status: 200 })
    }
}
