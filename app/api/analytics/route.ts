import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

        // Calculate date range in user's timezone
        const requestedTz = url.searchParams.get('timezone') || (myProfile as any)?.timezone || 'Asia/Kolkata'

        const getZonedNowParts = (tz: string) => {
          try {
            const fmt = new Intl.DateTimeFormat('en-CA', {
              timeZone: tz,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false
            })
            const parts = fmt.formatToParts(new Date())
            const pMap: Record<string, number> = {}
            parts.forEach(p => { if (p.type !== 'literal') pMap[p.type] = parseInt(p.value, 10) })
            return {
              year: pMap.year || new Date().getFullYear(),
              month: (pMap.month || (new Date().getMonth() + 1)) - 1,
              day: pMap.day || new Date().getDate()
            }
          } catch (e) {
            const d = new Date()
            return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }
          }
        }

        const getUtcDateForZonedMidnight = (year: number, month: number, day: number, tz: string, isEnd = false): Date => {
          try {
            const pad = (n: number) => String(n).padStart(2, '0')
            const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
            const timeStr = isEnd ? '23:59:59.999' : '00:00:00.000'
            const testIso = `${dateStr}T${timeStr}Z`
            const d = new Date(testIso)
            
            const invFormatter = new Intl.DateTimeFormat('en-US', {
              timeZone: tz,
              year: 'numeric', month: 'numeric', day: 'numeric',
              hour: 'numeric', minute: 'numeric', second: 'numeric',
              hour12: false
            })
            
            const targetParts = invFormatter.formatToParts(d)
            const zMap: Record<string, number> = {}
            targetParts.forEach(p => { if (p.type !== 'literal') zMap[p.type] = parseInt(p.value, 10) })
            
            const zHour = zMap.hour === 24 ? 0 : (zMap.hour || 0)
            const zDate = Date.UTC(zMap.year || year, (zMap.month || (month + 1)) - 1, zMap.day || day, zHour, zMap.minute || 0, zMap.second || 0)
            const diff = zDate - d.getTime()
            
            return new Date(d.getTime() - diff)
          } catch (e) {
            const fallback = new Date(year, month, day, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0, isEnd ? 999 : 0)
            return fallback
          }
        }

        const zParts = getZonedNowParts(requestedTz)
        let startDate: Date | null = null
        let endDate: Date | null = null

        const startDateParam = url.searchParams.get('startDate')
        const endDateParam = url.searchParams.get('endDate')
        const customDateParam = url.searchParams.get('customDate')

        if (customDateParam && customDateParam !== 'null' && customDateParam !== 'undefined') {
          const [cy, cm, cd] = customDateParam.split('-').map(Number)
          if (cy && cm && cd) {
            startDate = getUtcDateForZonedMidnight(cy, cm - 1, cd, requestedTz, false)
            endDate = getUtcDateForZonedMidnight(cy, cm - 1, cd, requestedTz, true)
          } else {
            startDate = new Date(customDateParam)
            endDate = new Date(customDateParam)
            endDate.setHours(23, 59, 59, 999)
          }
        } else if (startDateParam && startDateParam !== 'null' && startDateParam !== 'undefined') {
          const [sy, sm, sd] = startDateParam.split('-').map(Number)
          startDate = (sy && sm && sd) ? getUtcDateForZonedMidnight(sy, sm - 1, sd, requestedTz, false) : new Date(startDateParam)
          if (endDateParam && endDateParam !== 'null' && endDateParam !== 'undefined') {
            const [ey, em, ed] = endDateParam.split('-').map(Number)
            endDate = (ey && em && ed) ? getUtcDateForZonedMidnight(ey, em - 1, ed, requestedTz, true) : new Date(endDateParam)
          }
        } else {
          switch (duration) {
            case 'today':
              startDate = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, requestedTz, false)
              endDate = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, requestedTz, true)
              break
            case '7d':
              const d7 = new Date()
              d7.setDate(d7.getDate() - 7)
              const p7 = getZonedNowParts(requestedTz)
              startDate = getUtcDateForZonedMidnight(p7.year, p7.month, p7.day - 7, requestedTz, false)
              endDate = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, requestedTz, true)
              break
            case '30d':
              const p30 = getZonedNowParts(requestedTz)
              startDate = getUtcDateForZonedMidnight(p30.year, p30.month, p30.day - 30, requestedTz, false)
              endDate = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, requestedTz, true)
              break
            case 'this_month':
              startDate = getUtcDateForZonedMidnight(zParts.year, zParts.month, 1, requestedTz, false)
              endDate = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, requestedTz, true)
              break
            case 'last_month':
              const lastMonthIndex = zParts.month === 0 ? 11 : zParts.month - 1
              const lastMonthYear = zParts.month === 0 ? zParts.year - 1 : zParts.year
              const lastDayOfPrevMonth = new Date(lastMonthYear, lastMonthIndex + 1, 0).getDate()
              startDate = getUtcDateForZonedMidnight(lastMonthYear, lastMonthIndex, 1, requestedTz, false)
              endDate = getUtcDateForZonedMidnight(lastMonthYear, lastMonthIndex, lastDayOfPrevMonth, requestedTz, true)
              break
            case 'all':
            default:
              startDate = null
              endDate = null
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

        // Helper to apply workspace/agent filter to queries
        const applyLeadFilters = (queryBuilder: any) => {
            if (isTeamUser && activeAgentId) {
                return queryBuilder.or(`assigned_to.eq.${activeAgentId},user_id.eq.${activeAgentId}`)
            } else if (activeAgentId && activeAgentId !== 'unassigned') {
                return queryBuilder.or(`assigned_to.eq.${activeAgentId},user_id.eq.${activeAgentId}`)
            } else if (activeAgentId === 'unassigned') {
                return queryBuilder.is('assigned_to', null).in('user_id', workspaceTeamIds)
            } else {
                const workspaceOrConditions = workspaceTeamIds.flatMap(id => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',')
                return queryBuilder.or(workspaceOrConditions)
            }
        }

        // 1. Fetch CRM Leads across workspace using ultra-fast parallel batched queries
        const leadFields = 'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, facebook_lead_id, external_id, summary, value, next_followup, assigned_to, budget, timeline, priority_status, facebook_created_at, form_id, form_name, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience'

        const countQuery = applyLeadFilters(
            supabaseAdmin.from('leads').select('*', { count: 'exact', head: true })
        )
        const { count: totalLeadsCount } = await countQuery
        const totalRows = totalLeadsCount || 0
        const pageSize = 1000
        const totalPages = Math.min(Math.ceil(totalRows / pageSize) || 1, 50)

        // Parallel chunk helper
        const chunkArray = (arr: number[], size: number) => {
            const chunks: number[][] = []
            for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
            return chunks
        }

        const pageIndices = Array.from({ length: totalPages }, (_, i) => i)
        const leadChunks = chunkArray(pageIndices, 8)
        let rawLeadsBatch: any[] = []

        for (const chunk of leadChunks) {
            const chunkPromises = chunk.map(pageIdx => {
                const q = supabaseAdmin
                    .from('leads')
                    .select(leadFields)
                    .order('created_at', { ascending: false })
                    .range(pageIdx * pageSize, (pageIdx + 1) * pageSize - 1)
                return applyLeadFilters(q)
            })
            const results = await Promise.all(chunkPromises)
            for (const r of results) {
                if (r.data && r.data.length > 0) {
                    rawLeadsBatch = rawLeadsBatch.concat(r.data)
                }
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

        // 2. Fetch ALL Team Profiles for workspace leaderboard ranking & roster
        // Note: Do not select non-existent columns (e.g. timezone) to prevent Postgres query failures
        const { data: teamMembers, error: teamErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, full_name, role, created_at')
            .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)
            .order('created_at', { ascending: false })

        if (teamErr) {
            console.error('[Analytics API] Team profiles query error:', teamErr)
        }

        const rawTeamMembers = teamMembers || []

        // 3. Fetch lead_history entries in parallel for date range to compute call attempts
        let allHistoryLogs: any[] = []

        let historyCountQuery = supabaseAdmin
            .from('lead_history')
            .select('*', { count: 'exact', head: true })
        if (workspaceTeamIds.length > 0) {
            historyCountQuery = historyCountQuery.in('user_id', workspaceTeamIds)
        }
        if (startDate) historyCountQuery = historyCountQuery.gte('created_at', startDate.toISOString())
        if (endDate) historyCountQuery = historyCountQuery.lte('created_at', endDate.toISOString())

        const { count: totalHistoryCount } = await historyCountQuery
        const totalHistoryRows = totalHistoryCount || 0
        const historyBatchSize = 1000
        const totalHistoryPages = Math.min(Math.ceil(totalHistoryRows / historyBatchSize) || 1, 20)

        const historyPageIndices = Array.from({ length: totalHistoryPages }, (_, i) => i)
        const historyChunks = chunkArray(historyPageIndices, 8)

        for (const chunk of historyChunks) {
            const chunkPromises = chunk.map(pageIdx => {
                let hq = supabaseAdmin
                    .from('lead_history')
                    .select('id, lead_id, user_id, action_type, description, created_at')
                    .order('created_at', { ascending: false })
                    .range(pageIdx * historyBatchSize, (pageIdx + 1) * historyBatchSize - 1)
                if (workspaceTeamIds.length > 0) hq = hq.in('user_id', workspaceTeamIds)
                if (startDate) hq = hq.gte('created_at', startDate.toISOString())
                if (endDate) hq = hq.lte('created_at', endDate.toISOString())
                return hq
            })
            const results = await Promise.all(chunkPromises)
            for (const r of results) {
                if (r.data && r.data.length > 0) {
                    allHistoryLogs = allHistoryLogs.concat(r.data)
                }
            }
        }

        const isActualCallAction = (h: any) => {
          const type = (h.action_type || '').toUpperCase()
          const desc = (h.description || '').toLowerCase()
          if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT'].includes(type)) return false
          if (desc.includes('facebook ad submission') || desc.includes('reopened from facebook') || desc.includes('bulk transferred') || desc.includes('transferred from')) return false
          if (['CALL_FEEDBACK', 'CALL', 'OUTBOUND_CALL', 'CALL_LOG', 'DNP'].includes(type)) return true
          if (desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')) return true
          if (desc.includes('call') || desc.includes('followup') || desc.includes('feedback')) return true
          return false
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
            const memberCallCount = memberHistory.filter(isActualCallAction).length
            const memberLeadsDnpCount = memberLeads.filter(l => {
              let cf = l.custom_fields
              if (typeof cf === 'string') {
                try { cf = JSON.parse(cf) } catch(e) {}
              }
              const notesLower = (l.notes || '').toLowerCase()
              const stageLower = (l.pipeline_stage || l.status || '').toLowerCase()
              return cf?.last_call_dnp === true || (cf?.dnp_count > 0) || notesLower.includes('dnp') || stageLower.includes('dnp')
            }).length

            const totalDnpOnLeads = Math.max(
              memberHistory.filter(h => {
                const desc = (h.description || '').toLowerCase()
                const type = (h.action_type || '').toUpperCase()
                return type === 'DNP' || desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')
              }).length,
              memberLeadsDnpCount
            )

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
