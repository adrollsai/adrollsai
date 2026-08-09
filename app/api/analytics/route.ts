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

        // 1. Fetch CRM Leads using admin client (bypassing RLS)
        let leadsQuery = supabaseAdmin
            .from('leads')
            .select('*')
            .eq('user_id', targetOwnerId)

        if (startDate) {
            leadsQuery = leadsQuery.gte('created_at', startDate.toISOString())
        }
        if (endDate) {
            leadsQuery = leadsQuery.lte('created_at', endDate.toISOString())
        }
        if (activeAgentId) {
            leadsQuery = leadsQuery.eq('assigned_to', activeAgentId)
        }

        const { data: leads, error: leadsErr } = await leadsQuery
        if (leadsErr) {
            console.error("[Analytics API] Leads fetch error:", leadsErr)
        }
        const finalLeads = leads || []

        // 2. Fetch WhatsApp Chats & Messages
        let chatsQuery = supabaseAdmin
            .from('whatsapp_chats')
            .select('id, recipient_phone, recipient_name, lead_id, updated_at')
            .eq('user_id', targetOwnerId)

        if (activeAgentId) {
            const agentLeadIds = finalLeads.map(l => l.id)
            if (agentLeadIds.length > 0) {
                chatsQuery = chatsQuery.in('lead_id', agentLeadIds)
            } else {
                chatsQuery = chatsQuery.eq('id', '00000000-0000-0000-0000-000000000000')
            }
        }

        const { data: chats } = await chatsQuery
        const finalChats = chats || []
        const chatIds = finalChats.map(c => c.id)

        let finalMessages: any[] = []
        if (chatIds.length > 0) {
            let messagesQuery = supabaseAdmin
                .from('whatsapp_messages')
                .select('direction, created_at, chat_id')
                .in('chat_id', chatIds)

            if (startDate) {
                messagesQuery = messagesQuery.gte('created_at', startDate.toISOString())
            }
            if (endDate) {
                messagesQuery = messagesQuery.lte('created_at', endDate.toISOString())
            }

            const { data: messages } = await messagesQuery
            finalMessages = messages || []
        }

        // 3. Fetch Call & Action History logs
        let historyQuery = supabaseAdmin
            .from('lead_history')
            .select('id, lead_id, user_id, action_type, description, created_at')
        
        if (startDate) {
            historyQuery = historyQuery.gte('created_at', startDate.toISOString())
        }
        if (endDate) {
            historyQuery = historyQuery.lte('created_at', endDate.toISOString())
        }

        const { data: leadHistoryData } = await historyQuery
        const safeLeadHistory = leadHistoryData || []

        // 4. Fetch Team Members associated with workspace owner
        const { data: teamMembers } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, full_name, role, created_at')
            .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)
            .order('created_at', { ascending: false })

        const rawTeamMembers = teamMembers || []
        const safeTeamMembers = isTeamUser ? rawTeamMembers.filter(m => m.id === user.id) : rawTeamMembers

        const teamData = safeTeamMembers.map(member => {
            const memberLeads = finalLeads.filter(l => l.assigned_to === member.id)
            const wonLeads = memberLeads.filter(l => ['Won', 'Closed', 'Appointment done'].includes(l.pipeline_stage)).length
            const qualifiedLeads = memberLeads.filter(l => ['Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Won'].includes(l.pipeline_stage)).length
            const lostLeads = memberLeads.filter(l => ['Lost', 'Unqualified'].includes(l.pipeline_stage)).length
            
            const memberCallLogs = safeLeadHistory.filter(h => h.user_id === member.id && ['CALL_INITIATED', 'CALL_FEEDBACK', 'DNP', 'VOICE_CALL'].includes(h.action_type))
            const memberDnpLogs = safeLeadHistory.filter(h => h.user_id === member.id && (h.action_type === 'DNP' || (h.description && h.description.includes('DNP'))))
            
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
                    callsCount: Math.max(memberCallLogs.length, memberLeads.filter(l => l.last_called_by === member.id).length),
                    dnpCount: Math.max(totalDnpOnLeads, memberDnpLogs.length),
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
            chats: finalChats,
            messages: finalMessages,
            history: safeLeadHistory,
            team: teamData
        })

    } catch (e: any) {
        console.error('[Analytics API error]:', e)
        return NextResponse.json({ success: false, error: e.message || 'Internal Server Error' }, { status: 200 })
    }
}
