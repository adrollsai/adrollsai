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
        const isTeamUser = myRole === 'agent' || myRole === 'team_member'

        // Determine target workspace owner ID
        let targetOwnerId = user.id
        if (impersonateId && impersonateId !== 'null' && impersonateId !== 'undefined' && impersonateId !== user.id) {
            targetOwnerId = impersonateId
        } else if (isTeamUser && (myProfile?.parent_id || myProfile?.agency_id)) {
            targetOwnerId = myProfile.parent_id || myProfile.agency_id || user.id
        }

        // Determine active agent filter
        let activeAgentId = (filterAgentId && filterAgentId !== 'null' && filterAgentId !== 'undefined' && filterAgentId !== 'all') ? filterAgentId : null
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

        // Determine workspace team profile IDs
        let workspaceTeamIds: string[] = [targetOwnerId]
        const { data: workspaceTeamProfiles } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)

        if (workspaceTeamProfiles && workspaceTeamProfiles.length > 0) {
            workspaceTeamIds = Array.from(new Set(workspaceTeamProfiles.map(p => p.id)))
        }

        // 1. Fetch CRM Leads across workspace using fast paginated batches
        // NOTE: Do NOT filter leads by created_at date range here. The action report needs ALL leads
        // to cross-reference with history entries (a lead created months ago could be attempted today).
        // Date-based filtering for stats cards is handled on the frontend.
        const leadFields = 'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, facebook_lead_id, external_id, summary, value, next_followup, assigned_to, budget, timeline, priority_status, facebook_created_at, form_id, form_name, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience'

        let rawLeadsBatch: any[] = []
        let page = 0
        const pageSize = 1000
        let hasMore = true

        while (hasMore && page < 50) {
            let query = supabaseAdmin
                .from('leads')
                .select(leadFields)
                .range(page * pageSize, (page + 1) * pageSize - 1)
                .order('created_at', { ascending: false })

            if (isTeamUser && activeAgentId) {
                query = query.or(`assigned_to.eq.${activeAgentId},user_id.eq.${activeAgentId}`)
            } else if (activeAgentId && activeAgentId !== 'unassigned') {
                query = query.or(`assigned_to.eq.${activeAgentId},user_id.eq.${activeAgentId}`)
            } else if (activeAgentId === 'unassigned') {
                query = query.is('assigned_to', null).in('user_id', workspaceTeamIds)
            } else {
                const workspaceOrConditions = workspaceTeamIds.flatMap(id => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',')
                query = query.or(workspaceOrConditions)
            }

            const { data: pageLeads, error: leadsErr } = await query
            if (leadsErr) {
                console.error("[Analytics API] Leads fetch error:", leadsErr)
                break
            }

            if (!pageLeads || pageLeads.length === 0) {
                hasMore = false
            } else {
                rawLeadsBatch = rawLeadsBatch.concat(pageLeads)
                page++
                if (pageLeads.length < pageSize) hasMore = false
            }
        }

        const leadMap = new Map<string, any>()
        rawLeadsBatch.forEach(l => leadMap.set(l.id, l))

        const rawLeads = Array.from(leadMap.values())
        rawLeads.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

        const finalLeads = rawLeads.map(lead => {
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

        // 2. Fetch ALL Team Profiles for workspace leaderboard ranking
        const { data: teamMembers } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, full_name, role, created_at')
            .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)
            .order('created_at', { ascending: false })

        const rawTeamMembers = teamMembers || []

        // 3. Fetch lead_history entries for date range to compute call attempts
        // Scope history to workspace team members for accurate per-agent counting
        const leadIds = finalLeads.map(l => l.id)
        let allHistoryLogs: any[] = []

        // Fetch in batches of 2000 to get comprehensive history
        const historyBatchSize = 2000
        let historyPage = 0
        let historyHasMore = true

        while (historyHasMore && historyPage < 5) {
          let historyQuery = supabaseAdmin
            .from('lead_history')
            .select('id, lead_id, user_id, action_type, description, created_at')
            .order('created_at', { ascending: false })
            .range(historyPage * historyBatchSize, (historyPage + 1) * historyBatchSize - 1)

          // Filter by workspace team user IDs for relevant history
          if (workspaceTeamIds.length > 0) {
            historyQuery = historyQuery.in('user_id', workspaceTeamIds)
          }

          if (startDate) {
            historyQuery = historyQuery.gte('created_at', startDate.toISOString())
          }
          if (endDate) {
            historyQuery = historyQuery.lte('created_at', endDate.toISOString())
          }

          const { data: historyBatch } = await historyQuery
          if (!historyBatch || historyBatch.length === 0) {
            historyHasMore = false
          } else {
            allHistoryLogs = allHistoryLogs.concat(historyBatch)
            historyPage++
            if (historyBatch.length < historyBatchSize) historyHasMore = false
          }
        }

        const safeHistoryLogs = allHistoryLogs

        const teamData = rawTeamMembers.map(member => {
            const memberLeads = finalLeads.filter(l => l.assigned_to === member.id || l.user_id === member.id)
            const wonLeads = memberLeads.filter(l => ['Won', 'Closed', 'Appointment done', 'Deal/Token'].includes(l.pipeline_stage) || ['Won', 'Closed', 'Appointment done', 'Deal/Token'].includes(l.status)).length
            const qualifiedLeads = memberLeads.filter(l => ['Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Won', 'Negotiation', 'Visit Done'].includes(l.pipeline_stage) || ['Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Won', 'Negotiation', 'Visit Done'].includes(l.status)).length
            const lostLeads = memberLeads.filter(l => ['Lost', 'Unqualified', 'Lost/NI', 'Different Requirement'].includes(l.pipeline_stage) || ['Lost', 'Unqualified', 'Lost/NI', 'Different Requirement'].includes(l.status)).length
            
            const reqTakenCount = memberLeads.filter(l => l.status === 'Requirement Taken' || l.pipeline_stage === 'Contacted').length
            const visitPlannedCount = memberLeads.filter(l => l.status === 'Visit Planned' || l.pipeline_stage === 'Appointment booked').length
            const visitDoneCount = memberLeads.filter(l => l.status === 'Visit Done' || l.pipeline_stage === 'Appointment done').length
            const revisitDoneCount = memberLeads.filter(l => l.status === 'Revisit Done').length
            const negotiationCount = memberLeads.filter(l => l.status === 'Negotiation' || l.pipeline_stage === 'Qualified').length
            const dealTokenCount = memberLeads.filter(l => l.status === 'Deal/Token' || l.pipeline_stage === 'Closed' || l.pipeline_stage === 'Won').length

            const memberHistory = safeHistoryLogs.filter(h => h.user_id === member.id)
            const memberCallCount = memberHistory.filter(h => h.action_type === 'CALL_FEEDBACK' || h.action_type === 'REMARK' || h.action_type === 'STATUS_CHANGE').length || memberLeads.filter(l => l.last_called_by === member.id).length
            const totalDnpOnLeads = memberHistory.filter(h => h.description?.includes('DNP') || h.description?.includes('Call Not Picked')).length || memberLeads.reduce((acc, l) => acc + (l.dnp_count || l.custom_fields?.dnp_count || 0), 0)

            const conversionRate = memberLeads.length > 0 ? ((wonLeads / memberLeads.length) * 100).toFixed(1) : '0.0'

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
                    conversionRate,
                    reqTakenCount,
                    visitPlannedCount,
                    visitDoneCount,
                    revisitDoneCount,
                    negotiationCount,
                    dealTokenCount
                }
            }
        })

        // Privacy scoping for lead cards if team member user
        const safeLeads = isTeamUser ? finalLeads.filter(l => l.assigned_to === user.id || l.user_id === user.id) : finalLeads

        return NextResponse.json({
            success: true,
            duration,
            workspaceOwnerId: targetOwnerId,
            myRole,
            leads: safeLeads,
            totalCount: safeLeads.length,
            chats: [],
            messages: [],
            history: safeHistoryLogs,
            team: teamData
        })

    } catch (e: any) {
        console.error('[Analytics API error]:', e)
        return NextResponse.json({ success: false, error: e.message || 'Internal Server Error' }, { status: 200 })
    }
}
