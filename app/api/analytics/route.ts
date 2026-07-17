import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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

        // Fetch current session user's role and workspace linkage
        const { data: myProfile, error: profileErr } = await supabase
            .from('profiles')
            .select('role, parent_id, agency_id, business_name')
            .eq('id', user.id)
            .single()

        if (profileErr || !myProfile) {
            return NextResponse.json({ error: 'Failed to retrieve profile' }, { status: 500 })
        }

        const myRole = myProfile.role?.toLowerCase() || 'admin'
        
        // Impersonation check
        let isImpersonating = false
        let targetOwnerId = user.id
        
        if (impersonateId && impersonateId !== user.id) {
            if (['super_admin', 'agency', 'admin'].includes(myRole)) {
                targetOwnerId = impersonateId
                isImpersonating = true
            }
        }

        // Initialize admin DB client if impersonating to bypass RLS, else use session-scoped client
        const dbClient = isImpersonating
            ? createSupabaseAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
            : supabase

        // Resolve workspace owner ID
        let workspaceOwnerId = targetOwnerId
        if (!isImpersonating) {
            // For agents, the credit owner and workspace owner is their parent or agency
            if (myRole === 'agent') {
                workspaceOwnerId = myProfile.parent_id || myProfile.agency_id || user.id
            }
        }

        // Security reinforcement: if caller is agent, they can only view their own assigned data
        let activeAgentId = filterAgentId
        if (myRole === 'agent') {
            activeAgentId = user.id
        }

        // Calculate time range
        const now = new Date()
        let startDate: Date | null = null
        let endDate: Date | null = null

        switch (duration) {
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

        // 1. Fetch CRM Leads
        let leadsQuery = dbClient
            .from('leads')
            .select('id, created_at, pipeline_stage, assigned_to, name, phone, email, source')
            .eq('user_id', workspaceOwnerId)

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
        if (leadsErr) throw leadsErr

        const finalLeads = leads || []

        // 2. Fetch WhatsApp Chats & Messages
        let chatsQuery = dbClient
            .from('whatsapp_chats')
            .select('id, recipient_phone, recipient_name, lead_id, updated_at')
            .eq('user_id', workspaceOwnerId)

        if (activeAgentId) {
            // Only fetch chats linked to leads assigned to the agent
            const agentLeadIds = finalLeads.map(l => l.id)
            if (agentLeadIds.length > 0) {
                chatsQuery = chatsQuery.in('lead_id', agentLeadIds)
            } else {
                chatsQuery = chatsQuery.eq('id', '00000000-0000-0000-0000-000000000000') // yield empty
            }
        }

        const { data: chats, error: chatsErr } = await chatsQuery
        if (chatsErr) throw chatsErr

        const finalChats = chats || []
        const chatIds = finalChats.map(c => c.id)

        let finalMessages: any[] = []
        if (chatIds.length > 0) {
            let messagesQuery = dbClient
                .from('whatsapp_messages')
                .select('direction, created_at, chat_id')
                .in('chat_id', chatIds)

            if (startDate) {
                messagesQuery = messagesQuery.gte('created_at', startDate.toISOString())
            }
            if (endDate) {
                messagesQuery = messagesQuery.lte('created_at', endDate.toISOString())
            }

            const { data: messages, error: messagesErr } = await messagesQuery
            if (messagesErr) throw messagesErr
            finalMessages = messages || []
        }

        // 3. Fetch Team Performance if current user is admin/owner
        let teamData: any[] = []
        if (myRole !== 'agent') {
            const { data: teamMembers, error: teamErr } = await dbClient
                .from('profiles')
                .select('id, email, business_name, role, created_at')
                .eq('parent_id', workspaceOwnerId)
                .in('role', ['admin', 'agent'])
                .order('created_at', { ascending: false })

            if (!teamErr && teamMembers) {
                // Fetch ALL leads of workspace to compute breakdown
                let allWorkspaceLeadsQuery = dbClient
                    .from('leads')
                    .select('id, created_at, pipeline_stage, assigned_to')
                    .eq('user_id', workspaceOwnerId)

                if (startDate) {
                    allWorkspaceLeadsQuery = allWorkspaceLeadsQuery.gte('created_at', startDate.toISOString())
                }
                if (endDate) {
                    allWorkspaceLeadsQuery = allWorkspaceLeadsQuery.lte('created_at', endDate.toISOString())
                }

                const { data: allLeads } = await allWorkspaceLeadsQuery
                const safeAllLeads = allLeads || []

                // Fetch ALL chats to associate messages
                const { data: allChats } = await dbClient
                    .from('whatsapp_chats')
                    .select('id, lead_id')
                    .eq('user_id', workspaceOwnerId)
                
                const safeAllChats = allChats || []
                const allChatIds = safeAllChats.map(c => c.id)

                let allMessages: any[] = []
                if (allChatIds.length > 0) {
                    let allMessagesQuery = dbClient
                        .from('whatsapp_messages')
                        .select('direction, created_at, chat_id')
                        .in('chat_id', allChatIds)

                    if (startDate) {
                        allMessagesQuery = allMessagesQuery.gte('created_at', startDate.toISOString())
                    }
                    if (endDate) {
                        allMessagesQuery = allMessagesQuery.lte('created_at', endDate.toISOString())
                    }
                    const { data: allMsgs } = await allMessagesQuery
                    allMessages = allMsgs || []
                }

                teamData = teamMembers.map(member => {
                    const memberLeads = safeAllLeads.filter(l => l.assigned_to === member.id)
                    const wonLeads = memberLeads.filter(l => l.pipeline_stage === 'Won' || l.pipeline_stage === 'Closed').length
                    const lostLeads = memberLeads.filter(l => l.pipeline_stage === 'Lost' || l.pipeline_stage === 'Unqualified').length
                    
                    // Map lead IDs assigned to this member
                    const memberLeadIds = new Set(memberLeads.map(l => l.id))
                    const memberChats = safeAllChats.filter(c => c.lead_id && memberLeadIds.has(c.lead_id))
                    const memberChatIds = new Set(memberChats.map(c => c.id))
                    
                    const memberMessages = allMessages.filter(m => memberChatIds.has(m.chat_id))
                    const inboundMessages = memberMessages.filter(m => m.direction === 'inbound').length
                    const outboundMessages = memberMessages.filter(m => m.direction === 'outbound').length

                    return {
                        id: member.id,
                        email: member.email,
                        name: member.business_name || 'Team Member',
                        role: member.role,
                        metrics: {
                            leadsCount: memberLeads.length,
                            wonCount: wonLeads,
                            lostCount: lostLeads,
                            chatsCount: memberChats.length,
                            messagesCount: memberMessages.length,
                            inboundCount: inboundMessages,
                            outboundCount: outboundMessages
                        }
                    }
                })
            }
        }

        // Compile response payload
        return NextResponse.json({
            success: true,
            duration,
            workspaceOwnerId,
            myRole,
            leads: finalLeads,
            chats: finalChats,
            messages: finalMessages,
            team: teamData
        })

    } catch (e: any) {
        console.error('[Analytics API error]:', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
