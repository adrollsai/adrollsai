import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from "@google/generative-ai"
import { generateContentWithFallback } from "@/utils/gemini-fallback"
import { deductCredits, hasEnoughCredits, calculateLLMCost, deductCreditsByCost } from "@/utils/credits"

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(req.url)
        const impersonateId = url.searchParams.get('impersonate')
        
        let { duration } = await req.json().catch(() => ({ duration: '30d' }))

        // Fetch session user's role and workspace mapping
        const { data: myProfile, error: profileErr } = await supabase
            .from('profiles')
            .select('role, parent_id, agency_id')
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

        // Initialize admin client to perform credit updates and bypass RLS safely
        const supabaseAdmin = createSupabaseAdmin(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Resolve workspace owner ID
        let workspaceOwnerId = targetOwnerId
        if (!isImpersonating) {
            if (myRole === 'agent') {
                workspaceOwnerId = myProfile.parent_id || myProfile.agency_id || user.id
            }
        }



        // 2. Fetch current metrics snapshot (similar to GET route to get high fidelity stats)
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

        // A. Leads
        let leadsQuery = supabaseAdmin
            .from('leads')
            .select('id, created_at, pipeline_stage, assigned_to')
            .eq('user_id', workspaceOwnerId)

        if (startDate) leadsQuery = leadsQuery.gte('created_at', startDate.toISOString())
        if (endDate) leadsQuery = leadsQuery.lte('created_at', endDate.toISOString())

        const { data: leads } = await leadsQuery
        const finalLeads = leads || []

        // B. Chats & Messages
        const { data: chats } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('id, lead_id')
            .eq('user_id', workspaceOwnerId)

        const finalChats = chats || []
        const chatIds = finalChats.map(c => c.id)

        let inboundCount = 0
        let outboundCount = 0
        
        if (chatIds.length > 0) {
            let messagesQuery = supabaseAdmin
                .from('whatsapp_messages')
                .select('direction')
                .in('chat_id', chatIds)

            if (startDate) messagesQuery = messagesQuery.gte('created_at', startDate.toISOString())
            if (endDate) messagesQuery = messagesQuery.lte('created_at', endDate.toISOString())

            const { data: messages } = await messagesQuery
            if (messages) {
                inboundCount = messages.filter(m => m.direction === 'inbound').length
                outboundCount = messages.filter(m => m.direction === 'outbound').length
            }
        }

        // C. Team Breakdown
        const { data: teamMembers } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, role')
            .eq('parent_id', workspaceOwnerId)
            .in('role', ['admin', 'agent'])

        const finalTeam = teamMembers || []
        const teamMetrics = finalTeam.map(member => {
            const memberLeads = finalLeads.filter(l => l.assigned_to === member.id)
            const won = memberLeads.filter(l => l.pipeline_stage === 'Won' || l.pipeline_stage === 'Closed').length
            return {
                name: member.business_name || member.email || 'Team Member',
                role: member.role,
                leadsCount: memberLeads.length,
                wonCount: won
            }
        })

        // D. Calculate aggregate KPIs
        const totalLeads = finalLeads.length
        const wonLeads = finalLeads.filter(l => l.pipeline_stage === 'Won' || l.pipeline_stage === 'Closed').length
        const lostLeads = finalLeads.filter(l => l.pipeline_stage === 'Lost' || l.pipeline_stage === 'Unqualified').length
        const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0'
        
        // Stage breakdown
        const stagesSummary: Record<string, number> = {}
        finalLeads.forEach(l => {
            const stage = l.pipeline_stage || 'New'
            stagesSummary[stage] = (stagesSummary[stage] || 0) + 1
        })

        // Fetch creative assets from assets table
        const { data: assets } = await supabaseAdmin
            .from('assets')
            .select('type, caption, url')
            .eq('user_id', workspaceOwnerId)
            .limit(10)

        // Fetch Meta campaigns if connected
        let fbCampaigns: any[] = []
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('business_name, business_info, mission_statement, facebook_token, ad_account_id')
            .eq('id', workspaceOwnerId)
            .single()

        if (profile?.facebook_token && profile?.ad_account_id) {
            try {
                const cleanAdAccountId = profile.ad_account_id.startsWith('act_') 
                    ? profile.ad_account_id 
                    : `act_${profile.ad_account_id}`
                const fbUrl = `https://graph.facebook.com/v19.0/${cleanAdAccountId}/campaigns?fields=id,name,status,effective_status,objective,insights{results,spend,cpc,ctr}&limit=10&access_token=${profile.facebook_token}`
                const fbRes = await fetch(fbUrl)
                if (fbRes.ok) {
                    const fbData = await fbRes.json()
                    fbCampaigns = fbData.data || []
                }
            } catch (err) {
                console.error("Meta fetch error in AI analysis:", err)
            }
        }

        const businessName = profile?.business_name || 'Nobogent Client Workspace'
        const businessInfo = profile?.business_info || 'A business leveraging CRM and WhatsApp automation'

        // 3. Construct Gemini Prompt
        const prompt = `You are a growth marketing and revenue optimization AI assistant for ${businessName}.
Analyze the following business CRM and WhatsApp communication metrics for the current period (${duration}):

**BUSINESS PROFILE**
Name: ${businessName}
Info: ${businessInfo}
Mission: ${profile?.mission_statement || 'N/A'}

**CRM LEADS ACTIVITY**
- Total Leads Received: ${totalLeads}
- Won Leads (Conversions): ${wonLeads}
- Lost/Unqualified Leads: ${lostLeads}
- Current Conversion Rate: ${conversionRate}%
- Leads by Stage Breakdown:
${Object.entries(stagesSummary).map(([stage, count]) => `  * ${stage}: ${count}`).join('\n')}

**WHATSAPP COMMUNICATIONS**
- Total Conversations: ${finalChats.length}
- Total Messages Processed: ${inboundCount + outboundCount}
- Inbound Messages (Customer responses): ${inboundCount}
- Outbound Messages (Sent by business): ${outboundCount}
- Message Ratio: ${outboundCount > 0 ? (inboundCount / outboundCount).toFixed(2) : '0'} (Inbound per Outbound)

**TEAM PERFORMANCE**
${teamMetrics.map(t => `- Member: ${t.name} (${t.role}) | Assigned Leads: ${t.leadsCount} | Won Conversions: ${t.wonCount}`).join('\n')}

**META CAMPAIGNS**
${fbCampaigns.length > 0 
  ? fbCampaigns.map(c => `- Campaign: ${c.name} | Status: ${c.effective_status || c.status} | Spent: INR ${c.insights?.data?.[0]?.spend || '0'} | Results: ${c.insights?.data?.[0]?.results?.[0]?.value || '0'} leads`).join('\n')
  : '- No active Meta Ads campaigns connected.'}

**CREATIVE ASSETS**
${assets && assets.length > 0 
  ? assets.map(a => `- Creative Type: ${a.type} | Caption: ${a.caption || 'N/A'}`).join('\n')
  : '- No creative assets built in workspace yet.'}

Based on this data, provide a professional, highly strategic, and actionable revenue optimization analysis. Focus on concrete opportunities to grow revenue, increase conversions, and optimize communications, campaigns, and creative assets.

STYLE GUIDELINES (CRITICAL):
- Use very simple, everyday English. Do NOT use difficult business words, jargon, or long sentences.
- Keep the overall response length relatively short and concise.
- Focus strictly on practical, actionable next steps in bullet point form.

Structure your response using clean Markdown with the following specific sections:
1. **Executive Snapshot**: A short, simple summary (2-3 sentences max) of the pipeline and WhatsApp status.
2. **Campaign & Creative Optimization**: Practical bullet points on how to improve ad campaign performance, which targeting or creatives to adjust, and suggestions for future creative templates.
3. **WhatsApp Engagement & Conversions**: Practical next steps to optimize response rates and guide leads to conversion on WhatsApp.
4. **Immediate Action Checklist**: A clear checkbox list of 3-4 priority steps to execute.`

        // 4. Invoke Gemini API
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')
        const geminiResult = await generateContentWithFallback(genAI, prompt, 'gemini-3.5-flash')
        const recommendations = geminiResult.response.text()

        if (!recommendations) {
            throw new Error('Gemini API returned an empty response')
        }

        // 5. Calculate Actual Cost from Tokens and Deduct Credits (with 2x markup)
        const usage = geminiResult.response.usageMetadata
        const promptTokens = usage?.promptTokenCount || 0
        const completionTokens = usage?.candidatesTokenCount || 0
        
        // Calculate raw rupee cost (in INR)
        const rupeeCost = calculateLLMCost('gemini-3.5-flash', promptTokens, completionTokens)
        // Fallback safety to ensure at least 0.05 rupees is recorded if usage is not supplied
        const finalRupeeCost = rupeeCost > 0 ? rupeeCost : 0.05
        
        // Deduct using deductCreditsByCost (records 2x markup, e.g., 2 credits per rupee)
        const deducted = await deductCreditsByCost(
            supabaseAdmin,
            workspaceOwnerId,
            finalRupeeCost,
            'ai_generation',
            `AI Business Analysis: Revenue Optimization suggestions (${promptTokens} prompt tokens, ${completionTokens} response tokens)`
        )

        if (!deducted) {
            console.warn('[AI Analysis API] Note: Credit ledger write did not complete or was skipped.')
        }

        // 6. Cache analysis results in profiles table
        const analysisPayload = {
            timestamp: new Date().toISOString(),
            duration,
            recommendations,
            metricsSnapshot: {
                totalLeads,
                wonLeads,
                lostLeads,
                conversionRate,
                stagesSummary,
                chatsCount: finalChats.length,
                messagesCount: inboundCount + outboundCount,
                inboundCount,
                outboundCount
            }
        }

        // Check if last_ai_analysis column write works, fallback gracefully if column is missing
        const { error: updateErr } = await supabaseAdmin
            .from('profiles')
            .update({ last_ai_analysis: analysisPayload })
            .eq('id', workspaceOwnerId)

        if (updateErr) {
            console.error('[AI Analysis Route] Warning: Could not update last_ai_analysis column in profiles. (Migration might not have been applied yet):', updateErr)
        }

        return NextResponse.json({
            success: true,
            analysis: analysisPayload
        })

    } catch (e: any) {
        console.error('[AI Analysis API error]:', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
