import { createClient } from '@supabase/supabase-js';
import { generateText, tool, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { createCreativeSessionToken } from '@/utils/creative-token';
import { recordFeedbackOrIssue, getRecentLearnings } from './feedback-engine';
import { triggerOutboundCall } from '@/utils/voice-helper';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createKieImageTask } from '@/utils/external-apis';
import { getReferenceTemplate } from '@/utils/reference-templates-data';

export interface OwnerBotMediaAttachment {
    type: 'image' | 'document';
    url: string;
    filename?: string;
    caption?: string;
}

export interface OwnerBotResponse {
    text: string;
    mediaAttachments?: OwnerBotMediaAttachment[];
}

function escapeCsvValue(val: any): string {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();
    if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
    }
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

async function createQuickChartUrl(chartConfig: any): Promise<string> {
    try {
        const res = await fetch('https://quickchart.io/chart/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chart: chartConfig,
                backgroundColor: '#0f172a',
                width: 600,
                height: 400,
                devicePixelRatio: 2
            })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.url) {
                return data.url;
            }
        }
    } catch (e: any) {
        console.error('[OWNER BOT] QuickChart create error:', e);
    }
    return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&bkg=%230f172a&w=600&h=400&devicePixelRatio=2`;
}

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

/**
 * Text tasks strictly use DeepSeek v4.1-Flash ('deepseek-chat') via OpenAI-compatible chat completions
 */
function getLLMModel() {
    const rawKey = process.env.DEEPSEEK_API_KEY || '';
    const cleanKey = rawKey.replace(/^["']|["']$/g, '').trim();
    // Validate key format and check for known invalid keys
    if (cleanKey && cleanKey.startsWith('sk-') && !cleanKey.includes('invalid') && !cleanKey.includes('382f') && cleanKey.length >= 30) {
        try {
            const deepseek = createOpenAI({
                baseURL: 'https://api.deepseek.com/v1',
                apiKey: cleanKey,
                ...({ compatibility: 'compatible' } as any)
            });
            return deepseek.chat('deepseek-chat');
        } catch {
            // fallback
        }
    }
    return google('gemini-2.5-flash');
}

/**
 * Transcribes an incoming WhatsApp voice note using Gemini's native audio capability.
 */
export async function transcribeVoiceNote(audioBuffer: Buffer, mimeType = 'audio/ogg'): Promise<string> {
    try {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) return '';
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const base64Audio = audioBuffer.toString('base64');
        const res = await model.generateContent([
            {
                inlineData: {
                    mimeType: mimeType.includes('ogg') ? 'audio/ogg' : 'audio/mp3',
                    data: base64Audio
                }
            },
            {
                text: "Transcribe this voice note spoken by a business owner accurately. If spoken in Hindi/Hinglish or English, transcribe the exact spoken words. Output ONLY the transcription without quotes."
            }
        ]);

        return res.response.text().trim();
    } catch (err: any) {
        console.error('[OWNER BOT] Audio transcription error:', err);
        return '';
    }
}

/**
 * Handles incoming messages from business owners to the official Nobogent Master Bot.
 * Provides 100% feature parity with the Nobogent dashboard application.
 */
export async function processOwnerMessage(params: {
    userId: string;
    messageText: string;
    fromPhone: string;
    mediaUrl?: string;
    mediaType?: string;
}): Promise<OwnerBotResponse> {
    const { userId, messageText, fromPhone, mediaUrl, mediaType } = params;
    const mediaAttachments: OwnerBotMediaAttachment[] = [];

    // Fetch user profile and policies
    const [profRes, policyRes, learnings] = await Promise.all([
        supabaseAdmin
            .from('profiles')
            .select('id, email, parent_id, agency_id, business_name, business_info, address, contact_number, whatsapp_personal_number, whatsapp_phone_number, role, facebook_token, ad_account_id, selected_page_id, selected_page_token, whatsapp_waba_id, whatsapp_access_token, whatsapp_phone_number_id, privacy_policy_url, currency')
            .eq('id', userId)
            .single(),
        supabaseAdmin.from('agent_policies').select('*').eq('user_id', userId).maybeSingle(),
        getRecentLearnings(userId)
    ]);

    const profile = profRes.data;
    const policy = policyRes.data;
    const orgOwnerId = profile?.parent_id || profile?.agency_id || userId;

    // Fetch all registered team members under this workspace / agency
    const { data: teamRes } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, business_name, email, role, contact_number')
        .or(`id.eq.${orgOwnerId},parent_id.eq.${orgOwnerId},agency_id.eq.${orgOwnerId}`);

    const teamMembers = teamRes || [];
    const orgUserIds: string[] = [orgOwnerId];
    if (!orgUserIds.includes(userId)) orgUserIds.push(userId);
    teamMembers.forEach(m => {
        if (!orgUserIds.includes(m.id)) orgUserIds.push(m.id);
    });

    const businessName = profile?.business_name || 'your business';

    const teamListFormatted = teamMembers.map(m => {
        const displayName = m.full_name || m.business_name || m.email;
        return `- ${displayName} (Email: ${m.email || 'N/A'}, Role: ${m.role || 'agent'}, ID: ${m.id})`;
    }).join('\n') || 'No sub-agents or team members registered.';

    const systemPrompt = `
You are Nobogent Executive Co-pilot, the AI Intelligence and Analytics Director for ${businessName}.
You are interacting directly with the business owner / admin on WhatsApp.

WORKSPACE & ORGANIZATION CONTEXT:
- Organization Name: ${businessName}
- Workspace Owner ID: ${orgOwnerId}
- Current Admin/User ID: ${userId}
- Business Focus: ${profile?.business_info || 'Sales, Marketing & Lead Management'}
- Currency: ${profile?.currency || 'INR'}
- Active Telephony: Vobiz SIP Trunk / Master Telephony Connected

REGISTERED ORGANIZATION TEAM MEMBERS:
${teamListFormatted}

CRITICAL RULES FOR TEAM MEMBERS & CALLING STATUS:
1. People listed in "REGISTERED ORGANIZATION TEAM MEMBERS" above (such as Devraj, Amish, Amit, Sonam, etc.) are TEAM MEMBERS / AGENTS in this workspace, NOT leads!
2. When the admin asks about a person by name (e.g. "Devraj", "Amish", "calling status of leads assigned to Amish"), they are ALWAYS referring to the TEAM MEMBER!
3. NEVER reply that a team member is "just a lead" or has no activity without checking their assigned leads and calling performance!
4. Use 'get_team_member_performance' or 'get_team_calling_status' to fetch:
   - Total leads assigned in the CRM
   - Breakdown of assigned leads across stages (New, Contacted, Requirement Taken, Meeting Planned, Meeting Done, Visit Done, Deal/Token, Lost/NI)
   - Calling status breakdown (not_called vs called vs qualified_via_whatsapp)
   - Recent follow-up calls and remarks logged by that team member in CRM notes

ABSOLUTE SECURITY DIRECTIVE: STRICT READ-ONLY / INFORMATION EXTRACTION ONLY:
1. You have COMPLETE, 100% READ-ONLY extraction access to all database tables belonging strictly to this organization (${businessName}).
2. Database modifications (UPDATE, DELETE, INSERT, REASSIGN) through WhatsApp AI are STRICTLY FORBIDDEN to protect data integrity, prevent accidental data loss, and maintain audit trails.
3. If the admin asks to edit the database (e.g., "update lead stage to Deal Closed", "delete lead X", "assign 20 leads to Devraj", "add a new property to inventory", "change calling hours"):
   - You MUST politely decline with:
     "🔒 *Database modifications via WhatsApp AI are disabled for security and audit trail integrity.* I can extract, query, and analyze any information from your database, but please make changes directly in your Nobogent CRM dashboard."
   - NEVER pretend or promise that an edit was made in the database.

STRICT ORGANIZATION DATA ISOLATION:
1. You have access ONLY to data belonging to ${businessName} (organization ID: ${orgOwnerId}).
2. NEVER access, expose, query, or hallucinate data belonging to any other business or account.

EXECUTIVE WHATSAPP FORMATTING & PRESENTATION PROTOCOL (MANDATORY):
You are sending messages directly to a busy business owner's mobile phone on WhatsApp. Format EVERY response strictly according to these rules:
1. *Concise & Skimmable*: Keep responses compact, high-value, and punchy. No long rambling paragraphs.
2. *Bold Headers with Emojis*: Use WhatsApp bold syntax for clean section headers, e.g.:
   *📊 Pipeline Overview*
   *👥 Team Leaderboard*
   *📞 Telecalling Performance*
   *💡 Executive Takeaway*
3. *Emoji Bullet Points*: Use clean bullet points with bold metric labels and values, e.g.:
   • *Total Leads:* 16,151
   • *Active in Pipeline:* 8,420
   • *Connected Calls:* 311 (68.4% Connection Rate)
   • *Deals Closed:* 12 (₹8.4 Cr total volume)
4. *NEVER Use Markdown Tables*: NEVER use | Table | Column | syntax. Tables break, wrap chaotically, and are unreadable on mobile WhatsApp screens. Always format structured lists using bullet points.
5. *NEVER Use Markdown Headers*: NEVER use '#', '##', or '###'. WhatsApp chat renders these as ugly literal '#' characters. Use *Bold Text* with an emoji instead.
6. *Interesting & Actionable Commentary*: Always highlight key takeaways:
   - Point out bottlenecks (e.g. high DNP rate or leads lingering in 'New' stage).
   - Celebrate top performers.
   - Give 1 actionable next step or recommendation.

VISUAL GRAPHS & DOWNLOADABLE REPORTS:
1. When comparing pipeline stages, lead acquisition trends, or team leaderboards:
   - Call 'generate_analytics_graph' with chartType ('doughnut', 'bar', 'line', 'horizontalBar') to deliver a stunning dark-themed chart directly to their WhatsApp!
2. When the admin asks for an export, spreadsheet, full list, or file of leads/calls:
   - Call 'generate_downloadable_report' to compile a clean CSV and send it directly to their WhatsApp as a downloadable document!

COMPREHENSIVE DATABASE QUERY ENGINE ('query_organization_db'):
If the admin asks specific questions about leads, properties, calls, WhatsApp chats, ad campaigns, policies, or notifications:
- Use 'query_organization_db' to securely query the exact table, filter, and extract the relevant data, then summarize it beautifully for WhatsApp.
`;

    let promptText = messageText;
    if (mediaUrl && mediaType === 'image') {
        promptText = `${messageText || ''} [Attached Permanent Image URL: "${mediaUrl}". If the user wants to use this as an ad creative, call 'attach_image_to_inventory' or link to campaign]`.trim();
    }

    const readOnlyRefusal = {
        success: false,
        readOnlyEnforced: true,
        message: "Database modifications via WhatsApp AI are disabled for security and audit trail integrity. Admins can extract and query all organization data, but database edits (updating stages, assigning leads, creating records, modifying policies) must be performed directly in your Nobogent CRM dashboard."
    };

    const tools = {
        // --- 0. GENERAL READ-ONLY ORGANIZATION DATABASE QUERY ENGINE (MCP SUITE) ---
        query_organization_db: tool({
            description: "Secure, read-only MCP database query engine to extract any data strictly within this organization's database (leads, properties, call_logs, whatsapp_chats, whatsapp_messages, campaign_jobs, profiles/team, agent_policies, notifications, credit_transactions). Strictly executes SELECT queries; cannot modify data.",
            inputSchema: z.object({
                tableName: z.enum([
                    'leads',
                    'properties',
                    'call_logs',
                    'whatsapp_chats',
                    'whatsapp_messages',
                    'campaign_jobs',
                    'profiles',
                    'agent_policies',
                    'notifications',
                    'credit_transactions'
                ]).describe("Table to query"),
                select: z.string().default('*').describe("Columns to select e.g. 'id, name, phone, pipeline_stage, notes, created_at'"),
                filterField: z.string().optional().describe("Column to filter on"),
                filterOperator: z.enum(['eq', 'neq', 'ilike', 'gte', 'lte', 'gt', 'lt', 'is']).optional().default('eq'),
                filterValue: z.string().optional().describe("Filter value"),
                orderBy: z.string().optional().describe("Column to order by (defaults to created_at)"),
                orderAscending: z.boolean().optional().default(false),
                limit: z.number().default(20).describe("Max rows to return (up to 50)")
            }),
            execute: async ({ tableName, select, filterField, filterOperator, filterValue, orderBy, orderAscending, limit }) => {
                const cappedLimit = Math.min(Math.max(limit, 1), 50);
                let q = supabaseAdmin.from(tableName).select(select);

                // Security: strictly scope to orgUserIds
                if (tableName === 'leads') {
                    q = q.or(`user_id.in.(${orgUserIds.join(',')}),assigned_to.in.(${orgUserIds.join(',')})`);
                } else if (tableName === 'properties' || tableName === 'call_logs' || tableName === 'campaign_jobs' || tableName === 'agent_policies' || tableName === 'credit_transactions') {
                    q = q.in('user_id', orgUserIds);
                } else if (tableName === 'profiles') {
                    q = q.in('id', orgUserIds);
                } else if (tableName === 'whatsapp_chats') {
                    q = q.in('user_id', orgUserIds);
                } else if (tableName === 'whatsapp_messages') {
                    const { data: orgChats } = await supabaseAdmin.from('whatsapp_chats').select('id').in('user_id', orgUserIds).limit(500);
                    const chatIds = (orgChats || []).map(c => c.id);
                    if (chatIds.length === 0) return { totalFound: 0, rows: [] };
                    q = q.in('chat_id', chatIds);
                } else if (tableName === 'notifications') {
                    q = q.in('user_id', orgUserIds);
                }

                if (filterField && filterValue !== undefined) {
                    const cleanField = filterField.trim().replace(/[^a-zA-Z0-9_]/g, '');
                    if (filterOperator === 'ilike') q = q.ilike(cleanField, `%${filterValue}%`);
                    else if (filterOperator === 'neq') q = q.neq(cleanField, filterValue);
                    else if (filterOperator === 'gte') q = q.gte(cleanField, filterValue);
                    else if (filterOperator === 'lte') q = q.lte(cleanField, filterValue);
                    else if (filterOperator === 'gt') q = q.gt(cleanField, filterValue);
                    else if (filterOperator === 'lt') q = q.lt(cleanField, filterValue);
                    else if (filterOperator === 'is') q = q.is(cleanField, filterValue === 'null' ? null : filterValue);
                    else q = q.eq(cleanField, filterValue);
                }

                if (orderBy) {
                    const cleanOrder = orderBy.trim().replace(/[^a-zA-Z0-9_]/g, '');
                    q = q.order(cleanOrder, { ascending: orderAscending ?? false });
                } else if (['leads', 'properties', 'call_logs', 'whatsapp_chats', 'whatsapp_messages', 'campaign_jobs', 'notifications', 'credit_transactions'].includes(tableName)) {
                    q = q.order('created_at', { ascending: false });
                }

                const { data, error } = await q.limit(cappedLimit);
                if (error) {
                    return { success: false, error: error.message };
                }
                return {
                    success: true,
                    tableName,
                    totalFound: (data || []).length,
                    rows: data || []
                };
            }
        }),

        // --- 0. ORGANIZATION DATA CRUNCHING, VISUAL GRAPHS & DOWNLOADABLE REPORTS ---
        crunch_organization_analytics: tool({
            description: "Performs real-time, comprehensive data crunching across the entire organization CRM: total leads, funnel conversion rates, pipeline stages, agent performance leaderboard, source attribution, and telecalling analytics for any timeframe.",
            inputSchema: z.object({
                timeframe: z.enum(['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'all_time']).default('all_time'),
                campaignName: z.string().optional().describe("Optional campaign name filter"),
                assignedToMemberId: z.string().optional().describe("Optional agent filter")
            }),
            execute: async ({ timeframe, campaignName, assignedToMemberId }) => {
                const now = new Date();
                let startDate: Date | null = null;
                let endDate: Date | null = null;

                if (timeframe === 'today') {
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                } else if (timeframe === 'yesterday') {
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
                    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                } else if (timeframe === 'last_7_days') {
                    startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
                } else if (timeframe === 'last_30_days') {
                    startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
                } else if (timeframe === 'this_month') {
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                }

                let leadQ = supabaseAdmin
                    .from('leads')
                    .select('id, name, phone, pipeline_stage, source, ad_name, form_name, assigned_to, dnp_count, last_call_status, created_at, booked_time, budget')
                    .or(`user_id.in.(${orgUserIds.join(',')}),assigned_to.in.(${orgUserIds.join(',')})`);

                if (startDate) leadQ = leadQ.gte('created_at', startDate.toISOString());
                if (endDate) leadQ = leadQ.lt('created_at', endDate.toISOString());
                if (campaignName) leadQ = leadQ.or(`ad_name.ilike.%${campaignName}%,form_name.ilike.%${campaignName}%`);
                if (assignedToMemberId) leadQ = leadQ.eq('assigned_to', assignedToMemberId);

                let { data: leadsData } = await leadQ.limit(3000);
                let fallbackAllTimeNote = '';
                if ((!leadsData || leadsData.length === 0) && startDate) {
                    const { data: allTimeLeads } = await supabaseAdmin
                        .from('leads')
                        .select('id, name, phone, pipeline_stage, source, ad_name, form_name, assigned_to, dnp_count, last_call_status, created_at, booked_time, budget')
                        .or(`user_id.in.(${orgUserIds.join(',')}),assigned_to.in.(${orgUserIds.join(',')})`)
                        .limit(3000);
                    if (allTimeLeads && allTimeLeads.length > 0) {
                        leadsData = allTimeLeads;
                        fallbackAllTimeNote = `Note: 0 leads found strictly within timeframe '${timeframe}'. Results automatically populated with all-time records (${allTimeLeads.length} leads).`;
                    }
                }
                const leads = leadsData || [];

                const stageBreakdown: Record<string, number> = {};
                const sourceBreakdown: Record<string, number> = {};
                const campaignBreakdown: Record<string, number> = {};
                const agentLeadMap: Record<string, number> = {};
                let totalDnpCount = 0;
                let siteVisitsCount = 0;
                let dealsCount = 0;
                let contactedCount = 0;

                leads.forEach((l: any) => {
                    const st = l.pipeline_stage || 'New';
                    stageBreakdown[st] = (stageBreakdown[st] || 0) + 1;

                    const src = l.source || 'Direct / Meta';
                    sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;

                    const camp = l.ad_name || l.form_name;
                    if (camp) {
                        campaignBreakdown[camp] = (campaignBreakdown[camp] || 0) + 1;
                    }

                    const assignee = l.assigned_to || 'unassigned';
                    agentLeadMap[assignee] = (agentLeadMap[assignee] || 0) + 1;

                    if (l.dnp_count && l.dnp_count > 0) totalDnpCount += l.dnp_count;

                    const stLower = st.toLowerCase();
                    if (stLower.includes('contact') || stLower.includes('requirement')) contactedCount++;
                    if (stLower.includes('visit') || stLower.includes('meeting')) siteVisitsCount++;
                    if (stLower.includes('deal') || stLower.includes('token') || stLower.includes('won') || stLower.includes('closed')) dealsCount++;
                });

                // Calls in timeframe
                let callQ = supabaseAdmin
                    .from('call_logs')
                    .select('id, user_id, status, duration, call_type, created_at')
                    .in('user_id', orgUserIds);

                if (startDate) callQ = callQ.gte('created_at', startDate.toISOString());
                if (endDate) callQ = callQ.lt('created_at', endDate.toISOString());

                const { data: callData } = await callQ.limit(3000);
                const calls = callData || [];
                const connectedCalls = calls.filter((c: any) => c.status === 'CONNECTED' || (c.duration && c.duration > 0));
                const totalTalkTimeSecs = connectedCalls.reduce((s: number, c: any) => s + (c.duration || 0), 0);
                const avgCallDurationSecs = connectedCalls.length > 0 ? Math.round(totalTalkTimeSecs / connectedCalls.length) : 0;

                const memberLookup = new Map(teamMembers.map((m: any) => [m.id, m.full_name || m.business_name || m.email]));

                const agentLeaderboard = teamMembers.map((m: any) => {
                    const mCalls = calls.filter((c: any) => c.user_id === m.id);
                    const mConnected = mCalls.filter((c: any) => c.status === 'CONNECTED' || (c.duration && c.duration > 0));
                    const mLeads = leads.filter((l: any) => l.assigned_to === m.id);
                    const mDeals = mLeads.filter((l: any) => {
                        const s = (l.pipeline_stage || '').toLowerCase();
                        return s.includes('deal') || s.includes('token') || s.includes('won');
                    }).length;

                    return {
                        agentId: m.id,
                        agentName: memberLookup.get(m.id) || 'Agent',
                        role: m.role || 'agent',
                        assignedLeads: mLeads.length,
                        totalCalls: mCalls.length,
                        connectedCalls: mConnected.length,
                        dealsClosed: mDeals
                    };
                }).sort((a: any, b: any) => b.totalCalls - a.totalCalls);

                const totalLeads = leads.length;
                const contactRate = totalLeads > 0 ? `${(((contactedCount + siteVisitsCount + dealsCount) / totalLeads) * 100).toFixed(1)}%` : '0%';
                const siteVisitRate = totalLeads > 0 ? `${((siteVisitsCount / totalLeads) * 100).toFixed(1)}%` : '0%';
                const dealCloseRate = totalLeads > 0 ? `${((dealsCount / totalLeads) * 100).toFixed(1)}%` : '0%';

                return {
                    timeframe,
                    totalLeads,
                    pipelineStageBreakdown: stageBreakdown,
                    sourceAttribution: sourceBreakdown,
                    campaignBreakdown,
                    funnelConversionMetrics: {
                        totalLeads,
                        contactedLeads: contactedCount,
                        siteVisitsBooked: siteVisitsCount,
                        dealsClosed: dealsCount,
                        contactRate,
                        siteVisitRate,
                        dealCloseRate
                    },
                    telecallingAnalytics: {
                        totalCallsLogged: calls.length,
                        connectedCalls: connectedCalls.length,
                        connectionRate: calls.length > 0 ? `${((connectedCalls.length / calls.length) * 100).toFixed(1)}%` : '0%',
                        totalTalkTimeMinutes: Math.round(totalTalkTimeSecs / 60),
                        avgDurationSeconds: avgCallDurationSecs,
                        totalDnpFlagged: totalDnpCount
                    },
                    agentLeaderboard
                };
            }
        }),

        generate_analytics_graph: tool({
            description: "Generates an executive visual graph / chart (doughnut, pie, bar, horizontalBar, line) for lead stages, team leaderboard, daily trends, or marketing sources, and sends it directly to the owner/admin's WhatsApp.",
            inputSchema: z.object({
                chartType: z.enum(['doughnut', 'pie', 'bar', 'horizontalBar', 'line']).describe("Type of chart"),
                title: z.string().describe("Title displayed at the top of the graph"),
                labels: z.array(z.string()).describe("Labels for categories or dates e.g. ['New', 'Contacted', 'Site Visit', 'Deal']"),
                datasets: z.array(z.object({
                    label: z.string().describe("Dataset label e.g. 'Leads Count'"),
                    data: z.array(z.number()).describe("Numeric data points matching labels length")
                })),
                caption: z.string().optional().describe("WhatsApp image caption accompanying the graph")
            }),
            execute: async ({ chartType, title, labels, datasets, caption }) => {
                const vibrantPalette = [
                    '#38bdf8', '#818cf8', '#34d399', '#f59e0b', '#f43f5e',
                    '#a855f7', '#ec4899', '#14b8a6', '#06b6d4', '#eab308'
                ];

                const isCircular = chartType === 'doughnut' || chartType === 'pie';
                const formattedDatasets = datasets.map((ds, idx) => {
                    if (isCircular) {
                        return {
                            label: ds.label,
                            data: ds.data,
                            backgroundColor: vibrantPalette.slice(0, ds.data.length),
                            borderColor: '#0f172a',
                            borderWidth: 2
                        };
                    }
                    const color = vibrantPalette[idx % vibrantPalette.length];
                    return {
                        label: ds.label,
                        data: ds.data,
                        backgroundColor: chartType === 'line' ? `${color}33` : color,
                        borderColor: color,
                        borderWidth: chartType === 'line' ? 3 : 1,
                        fill: chartType === 'line'
                    };
                });

                const chartConfig = {
                    type: chartType === 'horizontalBar' ? 'horizontalBar' : chartType,
                    data: {
                        labels,
                        datasets: formattedDatasets
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            title: {
                                display: true,
                                text: title,
                                color: '#f8fafc',
                                font: { size: 18, weight: 'bold' },
                                padding: { top: 10, bottom: 20 }
                            },
                            legend: {
                                display: true,
                                position: isCircular ? 'bottom' : 'top',
                                labels: { color: '#cbd5e1', font: { size: 12 } }
                            },
                            datalabels: {
                                color: '#ffffff',
                                font: { weight: 'bold', size: 12 },
                                display: true,
                                formatter: (val: any) => val > 0 ? val : ''
                            }
                        },
                        scales: isCircular ? undefined : {
                            x: {
                                ticks: { color: '#94a3b8' },
                                grid: { color: 'rgba(255, 255, 255, 0.08)' }
                            },
                            y: {
                                ticks: { color: '#94a3b8' },
                                grid: { color: 'rgba(255, 255, 255, 0.08)' }
                            }
                        }
                    }
                };

                const chartUrl = await createQuickChartUrl(chartConfig);
                mediaAttachments.push({
                    type: 'image',
                    url: chartUrl,
                    caption: caption || `📊 ${title}`
                });

                return {
                    success: true,
                    chartUrl,
                    message: `Graph '${title}' has been generated and queued for direct WhatsApp delivery.`
                };
            }
        }),

        generate_downloadable_report: tool({
            description: "Generates an exportable, downloadable CSV report (all leads, team performance, hot leads, site visits, or call logs), uploads to cloud storage, and sends it directly to the owner/admin's WhatsApp as a downloadable document.",
            inputSchema: z.object({
                reportType: z.enum([
                    'leads_master',
                    'team_performance',
                    'hot_leads_site_visits',
                    'dnp_recovery',
                    'call_logs',
                    'campaign_performance'
                ]).describe("Type of report to compile"),
                stageFilter: z.string().optional().describe("Optional pipeline stage filter e.g. 'Site Visit', 'Deal', 'New'"),
                assignedToMemberId: z.string().optional().describe("Filter by specific team member UUID"),
                dateRange: z.enum(['today', 'yesterday', '7d', '30d', 'this_month', 'all']).default('all'),
                customTitle: z.string().optional().describe("Custom title for the report file")
            }),
            execute: async ({ reportType, stageFilter, assignedToMemberId, dateRange, customTitle }) => {
                try {
                    let csvContent = '';
                    let rowsCount = 0;
                    const now = new Date();
                    let startDate: Date | null = null;
                    if (dateRange === 'today') startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    else if (dateRange === 'yesterday') startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
                    else if (dateRange === '7d') startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
                    else if (dateRange === '30d') startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
                    else if (dateRange === 'this_month') startDate = new Date(now.getFullYear(), now.getMonth(), 1);

                    if (reportType === 'team_performance') {
                        const headers = ['Agent Name', 'Email', 'Role', 'Phone', 'Assigned Leads', 'Calls Logged', 'Connected Calls', 'Talk Time (Mins)', 'Site Visits', 'Deals Closed', 'Conversion Rate %'];
                        const rows = await Promise.all(teamMembers.map(async (m: any) => {
                            const [leadsRes, callsRes] = await Promise.all([
                                supabaseAdmin.from('leads').select('pipeline_stage').eq('assigned_to', m.id),
                                supabaseAdmin.from('call_logs').select('status, duration').eq('user_id', m.id)
                            ]);
                            const mLeads = leadsRes.data || [];
                            const mCalls = callsRes.data || [];
                            const connected = mCalls.filter((c: any) => c.status === 'CONNECTED' || (c.duration && c.duration > 0));
                            const talkTimeMins = Math.round(connected.reduce((s: number, c: any) => s + (c.duration || 0), 0) / 60);
                            const visits = mLeads.filter((l: any) => (l.pipeline_stage || '').toLowerCase().includes('visit')).length;
                            const deals = mLeads.filter((l: any) => (l.pipeline_stage || '').toLowerCase().includes('deal') || (l.pipeline_stage || '').toLowerCase().includes('token')).length;
                            const convRate = mLeads.length > 0 ? ((deals / mLeads.length) * 100).toFixed(1) : '0.0';

                            return [
                                escapeCsvValue(m.full_name || m.business_name || 'Agent'),
                                escapeCsvValue(m.email || ''),
                                escapeCsvValue(m.role || 'agent'),
                                escapeCsvValue(m.contact_number || ''),
                                escapeCsvValue(mLeads.length),
                                escapeCsvValue(mCalls.length),
                                escapeCsvValue(connected.length),
                                escapeCsvValue(talkTimeMins),
                                escapeCsvValue(visits),
                                escapeCsvValue(deals),
                                escapeCsvValue(`${convRate}%`)
                            ].join(',');
                        }));

                        csvContent = [headers.join(','), ...rows].join('\n');
                        rowsCount = rows.length;
                    } else if (reportType === 'call_logs') {
                        let callQ = supabaseAdmin
                            .from('call_logs')
                            .select('id, user_id, phone_number, call_type, status, duration, notes, started_at, created_at')
                            .in('user_id', orgUserIds)
                            .order('created_at', { ascending: false });

                        if (startDate) callQ = callQ.gte('created_at', startDate.toISOString());
                        const { data: calls } = await callQ.limit(2000);
                        const allCalls = calls || [];

                        const headers = ['Call ID', 'Phone Number', 'Type', 'Status', 'Duration (Secs)', 'Date & Time', 'Notes'];
                        const rows = allCalls.map((c: any) => [
                            escapeCsvValue(c.id),
                            escapeCsvValue(c.phone_number),
                            escapeCsvValue(c.call_type || 'outbound'),
                            escapeCsvValue(c.status),
                            escapeCsvValue(c.duration || 0),
                            escapeCsvValue(c.created_at ? new Date(c.created_at).toLocaleString('en-IN') : ''),
                            escapeCsvValue(c.notes || '')
                        ].join(','));

                        csvContent = [headers.join(','), ...rows].join('\n');
                        rowsCount = rows.length;
                    } else {
                        let leadQ = supabaseAdmin
                            .from('leads')
                            .select('id, name, phone, email, pipeline_stage, source, ad_name, form_name, assigned_to, dnp_count, last_call_status, last_call_at, booked_time, notes, created_at, budget')
                            .or(`user_id.in.(${orgUserIds.join(',')}),assigned_to.in.(${orgUserIds.join(',')})`)
                            .order('created_at', { ascending: false });

                        if (startDate) leadQ = leadQ.gte('created_at', startDate.toISOString());
                        if (stageFilter) leadQ = leadQ.ilike('pipeline_stage', `%${stageFilter}%`);
                        if (assignedToMemberId) leadQ = leadQ.eq('assigned_to', assignedToMemberId);
                        if (reportType === 'hot_leads_site_visits') {
                            leadQ = leadQ.or('pipeline_stage.ilike.%visit%,pipeline_stage.ilike.%meeting%,pipeline_stage.ilike.%deal%,pipeline_stage.ilike.%token%');
                        } else if (reportType === 'dnp_recovery') {
                            leadQ = leadQ.or('dnp_count.gte.1,last_call_status.eq.DNP,pipeline_stage.ilike.%dnp%');
                        }

                        let { data: leads } = await leadQ.limit(3000);
                        if ((!leads || leads.length === 0) && startDate) {
                            let fallbackQ = supabaseAdmin
                                .from('leads')
                                .select('id, name, phone, email, pipeline_stage, source, ad_name, form_name, assigned_to, dnp_count, last_call_status, last_call_at, booked_time, notes, created_at, budget')
                                .or(`user_id.in.(${orgUserIds.join(',')}),assigned_to.in.(${orgUserIds.join(',')})`)
                                .order('created_at', { ascending: false });
                            if (stageFilter) fallbackQ = fallbackQ.ilike('pipeline_stage', `%${stageFilter}%`);
                            if (assignedToMemberId) fallbackQ = fallbackQ.eq('assigned_to', assignedToMemberId);
                            const fbRes = await fallbackQ.limit(3000);
                            if (fbRes.data && fbRes.data.length > 0) leads = fbRes.data;
                        }
                        const allLeads = leads || [];
                        const agentMap = new Map(teamMembers.map((a: any) => [a.id, a.full_name || a.business_name || a.email]));

                        const headers = [
                            'Lead ID', 'Name', 'Phone', 'Email', 'Pipeline Stage',
                            'Assigned Agent', 'Source', 'Ad / Campaign', 'Lead Form',
                            'Budget', 'DNP Count', 'Last Call Status', 'Last Call Time', 'Booked Visit Time',
                            'Created Date', 'Notes'
                        ];

                        const rows = allLeads.map((l: any) => [
                            escapeCsvValue(l.id),
                            escapeCsvValue(l.name),
                            escapeCsvValue(l.phone),
                            escapeCsvValue(l.email || ''),
                            escapeCsvValue(l.pipeline_stage || 'New'),
                            escapeCsvValue(agentMap.get(l.assigned_to) || 'Unassigned'),
                            escapeCsvValue(l.source || 'Direct'),
                            escapeCsvValue(l.ad_name || ''),
                            escapeCsvValue(l.form_name || ''),
                            escapeCsvValue(l.budget || ''),
                            escapeCsvValue(l.dnp_count || 0),
                            escapeCsvValue(l.last_call_status || ''),
                            escapeCsvValue(l.last_call_at ? new Date(l.last_call_at).toLocaleString('en-IN') : ''),
                            escapeCsvValue(l.booked_time ? new Date(l.booked_time).toLocaleString('en-IN') : ''),
                            escapeCsvValue(l.created_at ? new Date(l.created_at).toLocaleString('en-IN') : ''),
                            escapeCsvValue(l.notes || '')
                        ].join(','));

                        csvContent = [headers.join(','), ...rows].join('\n');
                        rowsCount = rows.length;
                    }

                    const baseName = customTitle || `${reportType}_${dateRange}`;
                    const cleanFileName = `${baseName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.csv`;
                    const r2Key = `reports/${userId}/${cleanFileName}`;

                    await r2.send(new PutObjectCommand({
                        Bucket: R2_BUCKET,
                        Key: r2Key,
                        Body: csvContent,
                        ContentType: 'text/csv'
                    }));

                    const downloadUrl = `${R2_PUBLIC_URL}/${r2Key}`;
                    mediaAttachments.push({
                        type: 'document',
                        url: downloadUrl,
                        filename: cleanFileName,
                        caption: `📥 ${customTitle || reportType.replace(/_/g, ' ').toUpperCase()} (${rowsCount} records)`
                    });

                    return {
                        success: true,
                        downloadUrl,
                        fileName: cleanFileName,
                        rowsCount,
                        message: `Report generated with ${rowsCount} records and uploaded to secure cloud storage. Downloadable file sent to WhatsApp.`
                    };
                } catch (err: any) {
                    console.error('[OWNER BOT] Report generation error:', err);
                    return { success: false, error: err.message };
                }
            }
        }),

        query_custom_crm_data: tool({
            description: "Queries targeted leads with specific criteria (e.g. leads in a specific stage, leads with high DNP count, uncalled leads, or matching a search text).",
            inputSchema: z.object({
                stage: z.string().optional().describe("Pipeline stage name"),
                minDnpCount: z.number().optional().describe("Minimum DNP count e.g. 2"),
                callingStatus: z.enum(['all', 'not_called', 'called', 'failed', 'connected']).default('all'),
                searchQuery: z.string().optional().describe("Search across name, phone, notes, or project"),
                limit: z.number().default(15)
            }),
            execute: async ({ stage, minDnpCount, callingStatus, searchQuery, limit }) => {
                let q = supabaseAdmin
                    .from('leads')
                    .select('id, name, phone, email, pipeline_stage, voice_call_status, dnp_count, last_call_status, assigned_to, notes, created_at')
                    .in('user_id', orgUserIds)
                    .order('created_at', { ascending: false });

                if (stage) q = q.ilike('pipeline_stage', `%${stage}%`);
                if (minDnpCount !== undefined && minDnpCount > 0) q = q.gte('dnp_count', minDnpCount);
                if (callingStatus && callingStatus !== 'all') {
                    if (callingStatus === 'not_called') q = q.or('voice_call_status.is.null,voice_call_status.eq.not_called');
                    else if (callingStatus === 'called') q = q.eq('voice_call_status', 'called');
                    else if (callingStatus === 'failed') q = q.in('last_call_status', ['DNP', 'FAILED', 'BUSY', 'NOT_CONNECTED']);
                    else if (callingStatus === 'connected') q = q.eq('last_call_status', 'CONNECTED');
                }
                if (searchQuery) {
                    const sq = searchQuery.trim();
                    q = q.or(`name.ilike.%${sq}%,phone.ilike.%${sq}%,notes.ilike.%${sq}%`);
                }

                const { data: matched } = await q.limit(limit);
                return {
                    matchedCount: (matched || []).length,
                    leads: (matched || []).map((l: any) => ({
                        id: l.id,
                        name: l.name,
                        phone: l.phone,
                        stage: l.pipeline_stage,
                        dnpCount: l.dnp_count || 0,
                        lastCallStatus: l.last_call_status || 'N/A',
                        notesSnippet: (l.notes || '').replace(/\s+/g, ' ').slice(0, 100)
                    }))
                };
            }
        }),

        // --- 1. TEAM MEMBERS & STAFF MANAGEMENT ---
        list_team_members: tool({
            description: "Lists all registered team members (agents, admins) under this workspace with their roles, contact details, and assigned lead counts.",
            inputSchema: z.object({}),
            execute: async () => {
                const { data: members } = await supabaseAdmin
                    .from('profiles')
                    .select('id, full_name, business_name, email, role, contact_number, created_at')
                    .or(`id.eq.${orgOwnerId},parent_id.eq.${orgOwnerId},agency_id.eq.${orgOwnerId}`)
                    .order('created_at', { ascending: false });

                if (!members || members.length === 0) {
                    return { teamMembers: [], message: 'No team members registered under this workspace.' };
                }

                const enriched = await Promise.all(members.map(async (m: any) => {
                    const [leadCount, callCount] = await Promise.all([
                        supabaseAdmin.from('leads').select('*', { count: 'exact', head: true }).eq('assigned_to', m.id),
                        supabaseAdmin.from('call_logs').select('*', { count: 'exact', head: true }).eq('user_id', m.id)
                    ]);
                    return {
                        id: m.id,
                        name: m.full_name || m.business_name || m.email,
                        email: m.email,
                        role: m.role,
                        phone: m.contact_number || 'N/A',
                        totalLeadsAssigned: leadCount.count || 0,
                        totalCallsLogged: callCount.count || 0
                    };
                }));

                return { teamMembers: enriched };
            }
        }),

        get_team_member_performance: tool({
            description: "Gets detailed performance metrics for a specific team member (e.g. 'Devraj'): total assigned leads, pipeline stage breakdown, calling status, follow-up remarks in CRM notes, and call logs.",
            inputSchema: z.object({
                memberNameOrId: z.string().describe("Team member's name, email, or UUID")
            }),
            execute: async ({ memberNameOrId }) => {
                let memberId = memberNameOrId;
                let targetMember: any = null;
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

                if (uuidRegex.test(memberNameOrId)) {
                    const { data } = await supabaseAdmin.from('profiles').select('id, full_name, business_name, email, role').eq('id', memberNameOrId).maybeSingle();
                    targetMember = data;
                } else {
                    const { data: matched } = await supabaseAdmin
                        .from('profiles')
                        .select('id, full_name, business_name, email, role')
                        .or(`parent_id.eq.${userId},agency_id.eq.${userId}`)
                        .or(`full_name.ilike.%${memberNameOrId}%,business_name.ilike.%${memberNameOrId}%,email.ilike.%${memberNameOrId}%`)
                        .limit(1);
                    if (matched && matched.length > 0) {
                        targetMember = matched[0];
                        memberId = targetMember.id;
                    }
                }

                if (!targetMember) {
                    return { error: `No team member found matching '${memberNameOrId}'. Use list_team_members to view all team members.` };
                }

                // 1. Total exact count of leads assigned to this member
                const { count: totalAssignedCount } = await supabaseAdmin
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .eq('assigned_to', memberId);

                // 2. Fetch all leads assigned to this member to compute stage and calling breakdown
                const { data: assignedLeads } = await supabaseAdmin
                    .from('leads')
                    .select('id, name, phone, pipeline_stage, voice_call_status, notes, booked_time, created_at')
                    .eq('assigned_to', memberId)
                    .order('created_at', { ascending: false })
                    .limit(1000);

                const leads = assignedLeads || [];
                const stageCounts: Record<string, number> = {};
                const voiceCallStatusCounts: Record<string, number> = {};
                const memberRemarks: Array<{ leadName: string; phone: string; remark: string }> = [];

                const emailPrefix = targetMember.email ? targetMember.email.split('@')[0].toLowerCase() : '';
                const memberNameLower = (targetMember.full_name || targetMember.business_name || '').toLowerCase();

                leads.forEach((l: any) => {
                    const stage = l.pipeline_stage || 'New';
                    stageCounts[stage] = (stageCounts[stage] || 0) + 1;

                    const callStatus = l.voice_call_status || 'not_called';
                    voiceCallStatusCounts[callStatus] = (voiceCallStatusCounts[callStatus] || 0) + 1;

                    if (l.notes && memberRemarks.length < 8) {
                        const nLower = l.notes.toLowerCase();
                        if ((emailPrefix && nLower.includes(emailPrefix)) || (memberNameLower && nLower.includes(memberNameLower))) {
                            memberRemarks.push({
                                leadName: l.name || 'Lead',
                                phone: l.phone || 'N/A',
                                remark: l.notes.replace(/\s+/g, ' ').trim().slice(0, 160)
                            });
                        }
                    }
                });

                // 3. Fetch call logs from call_logs table
                const { data: callLogs } = await supabaseAdmin
                    .from('call_logs')
                    .select('id, phone_number, call_type, duration, status, notes, started_at, created_at')
                    .eq('user_id', memberId)
                    .order('created_at', { ascending: false })
                    .limit(20);

                return {
                    teamMember: {
                        id: targetMember.id,
                        name: targetMember.full_name || targetMember.business_name || targetMember.email,
                        email: targetMember.email,
                        role: targetMember.role
                    },
                    totalLeadsAssigned: totalAssignedCount || leads.length,
                    pipelineStageBreakdown: stageCounts,
                    voiceCallingStatusBreakdown: voiceCallStatusCounts,
                    recentFollowUpRemarksByMember: memberRemarks,
                    callLogsLoggedCount: (callLogs || []).length,
                    recentCallLogs: callLogs || []
                };
            }
        }),

        assign_leads_to_team_member: tool({
            description: "Assigns or reassigns CRM leads to a team member (BLOCKED: Read-only access enforced).",
            inputSchema: z.object({
                leadIdentifiers: z.array(z.string()).describe("Lead UUIDs, names, or phone numbers to assign"),
                targetMemberNameOrId: z.string().describe("Target team member's name, email, or UUID")
            }),
            execute: async () => {
                return readOnlyRefusal;
            }
        }),

        transfer_leads: tool({
            description: "Transfers leads in bulk to another team member (BLOCKED: Read-only access enforced).",
            inputSchema: z.object({
                fromMemberNameOrId: z.string().describe("Source team member name/email/UUID, or 'unassigned'"),
                toMemberNameOrId: z.string().describe("Target team member name/email/UUID"),
                stage: z.string().optional().describe("Optional pipeline stage filter, e.g. 'New'"),
                limit: z.number().default(50).describe("Maximum number of leads to transfer")
            }),
            execute: async () => {
                return readOnlyRefusal;
            }
        }),

        // --- 2. CRM & LEAD PIPELINE MANAGEMENT ---
        search_leads: tool({
            description: "Searches for leads in the CRM database by name, phone number, email, or notes across the workspace.",
            inputSchema: z.object({
                query: z.string().describe("Name, phone, or email to search for"),
                stage: z.string().optional().describe("Optional stage filter")
            }),
            execute: async ({ query, stage }) => {
                const cleanQuery = query.trim();
                let q = supabaseAdmin
                    .from('leads')
                    .select('id, name, phone, email, pipeline_stage, notes, assigned_to, source, created_at')
                    .or(`user_id.in.(${orgUserIds.join(',')}),assigned_to.in.(${orgUserIds.join(',')})`)
                    .or(`name.ilike.%${cleanQuery}%,phone.ilike.%${cleanQuery}%,email.ilike.%${cleanQuery}%,notes.ilike.%${cleanQuery}%`);

                if (stage) q = q.eq('pipeline_stage', stage);
                const { data: matched } = await q.limit(10);
                return matched || [];
            }
        }),

        get_lead_details: tool({
            description: "Fetches full profile, notes, followups, and call status of a specific lead by UUID, phone number, or name.",
            inputSchema: z.object({
                leadIdentifier: z.string().describe("Lead UUID, phone number, or name")
            }),
            execute: async ({ leadIdentifier }) => {
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadIdentifier);
                let q = supabaseAdmin.from('leads').select('*').or(`user_id.in.(${orgUserIds.join(',')}),assigned_to.in.(${orgUserIds.join(',')})`);
                if (isUuid) {
                    q = q.eq('id', leadIdentifier);
                } else {
                    q = q.or(`phone.ilike.%${leadIdentifier}%,name.ilike.%${leadIdentifier}%`);
                }

                const { data: lead } = await q.maybeSingle();
                if (!lead) return { error: `Lead '${leadIdentifier}' not found.` };

                let assignedAgentName = 'Unassigned';
                if (lead.assigned_to) {
                    const { data: agent } = await supabaseAdmin.from('profiles').select('full_name, business_name, email').eq('id', lead.assigned_to).maybeSingle();
                    if (agent) assignedAgentName = agent.full_name || agent.business_name || agent.email;
                }

                return { ...lead, assignedAgentName };
            }
        }),

        update_lead_stage: tool({
            description: "Updates the pipeline stage of a lead (BLOCKED: Read-only access enforced).",
            inputSchema: z.object({
                leadIdentifier: z.string().describe("Lead UUID, phone number, or name"),
                newStage: z.string().describe("Target pipeline stage"),
                notes: z.string().optional().describe("Optional notes/remarks to append")
            }),
            execute: async () => {
                return readOnlyRefusal;
            }
        }),

        get_leads_by_stage: tool({
            description: "Fetches leads in a specific pipeline stage.",
            inputSchema: z.object({
                stageName: z.string().describe("Pipeline stage name, e.g. 'Contacted', 'Meeting Done', 'New'"),
                limit: z.number().default(10)
            }),
            execute: async ({ stageName, limit }) => {
                const { data: leads } = await supabaseAdmin
                    .from('leads')
                    .select('id, name, phone, email, pipeline_stage, assigned_to, created_at')
                    .or(`user_id.in.(${orgUserIds.join(',')}),assigned_to.in.(${orgUserIds.join(',')})`)
                    .ilike('pipeline_stage', `%${stageName}%`)
                    .limit(limit);
                return leads || [];
            }
        }),

        add_crm_lead: tool({
            description: "Adds a new lead into the CRM (BLOCKED: Read-only access enforced).",
            inputSchema: z.object({
                name: z.string().describe("Lead full name"),
                phone: z.string().describe("Lead phone number"),
                email: z.string().optional(),
                pipeline_stage: z.string().default('New'),
                budget: z.string().optional(),
                notes: z.string().optional(),
                assignToMemberNameOrId: z.string().optional()
            }),
            execute: async () => {
                return readOnlyRefusal;
            }
        }),

        // --- 3. CALLING & TELECALLER OUTREACH ---
        get_team_calling_status: tool({
            description: "Provides an overview of calling activity, connected calls, DNP/missed calls, and follow-ups across the workspace team or for a specific team member.",
            inputSchema: z.object({
                memberNameOrId: z.string().optional().describe("Optional team member to filter by"),
                timeframe: z.enum(['today', 'yesterday', 'this_week', 'all']).default('all')
            }),
            execute: async ({ memberNameOrId, timeframe }) => {
                let memberId: string | null = null;
                if (memberNameOrId) {
                    const { data: members } = await supabaseAdmin
                        .from('profiles')
                        .select('id, full_name, business_name, email')
                        .or(`parent_id.eq.${userId},agency_id.eq.${userId}`)
                        .or(`full_name.ilike.%${memberNameOrId}%,business_name.ilike.%${memberNameOrId}%,email.ilike.%${memberNameOrId}%,id.eq.${memberNameOrId}`)
                        .limit(1);
                    if (members && members.length > 0) memberId = members[0].id;
                }

                let callQuery = supabaseAdmin.from('call_logs').select('id, phone_number, status, duration, call_type, notes, created_at');
                if (memberId) {
                    callQuery = callQuery.eq('user_id', memberId);
                } else {
                    callQuery = callQuery.eq('user_id', userId);
                }

                if (timeframe === 'today') {
                    const start = new Date(); start.setHours(0, 0, 0, 0);
                    callQuery = callQuery.gte('created_at', start.toISOString());
                } else if (timeframe === 'this_week') {
                    const start = new Date(Date.now() - 7 * 24 * 3600 * 1000);
                    callQuery = callQuery.gte('created_at', start.toISOString());
                }

                const { data: calls } = await callQuery.limit(100);
                const allCalls = calls || [];
                const connected = allCalls.filter(c => c.status === 'CONNECTED' || (c.duration && c.duration > 0));
                const missed = allCalls.filter(c => ['NOT_CONNECTED', 'FAILED', 'BUSY', 'REJECTED', 'DNP', 'MISSED'].includes(c.status));

                return {
                    timeframe,
                    totalCallsLogged: allCalls.length,
                    connectedCount: connected.length,
                    missedOrDnpCount: missed.length,
                    avgDurationSeconds: connected.length > 0 ? Math.round(connected.reduce((s, c) => s + (c.duration || 0), 0) / connected.length) : 0,
                    sampleRecentCalls: allCalls.slice(0, 5)
                };
            }
        }),

        trigger_ai_call: tool({
            description: "Triggers an instant autonomous AI voice call to a lead or test phone number using Nobogent's voice AI calling engine.",
            inputSchema: z.object({
                leadIdOrPhone: z.string().describe("Lead UUID or phone number to call (or 'me' / 'my number' / 'self' for the owner's phone)"),
                forceNow: z.boolean().default(true).describe("Force dial immediately"),
                topicOrNotes: z.string().optional().describe("Specific topic, objective, or instruction for what the voice AI should discuss on the call (e.g. 'Ask them what are their plans on Nobogent basically')")
            }),
            execute: async ({ leadIdOrPhone, forceNow, topicOrNotes }) => {
                try {
                    let targetLeadId = leadIdOrPhone;
                    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadIdOrPhone);

                    if (!isUuid) {
                        let phoneToDial = (leadIdOrPhone || '').trim();
                        // Handle owner self-dialing shortcuts
                        if (/^(me|myself|my\s*number|self|admin|super\s*admin)$/i.test(phoneToDial) || !phoneToDial) {
                            phoneToDial = profile?.whatsapp_personal_number || profile?.contact_number || '8288835235';
                        }

                        // Auto-correct 9 digits typos matching the user's registered phone
                        let cleanDigits = phoneToDial.replace(/\D/g, '');
                        const registeredDigits = (profile?.whatsapp_personal_number || profile?.contact_number || '8288835235').replace(/\D/g, '');
                        if (cleanDigits.length === 9 && registeredDigits.includes(cleanDigits)) {
                            phoneToDial = registeredDigits;
                            cleanDigits = registeredDigits;
                        }

                        const { data: existingLead } = await supabaseAdmin
                            .from('leads')
                            .select('id, custom_fields, notes')
                            .eq('user_id', userId)
                            .or(`phone.ilike.%${cleanDigits.slice(-10)}%`)
                            .limit(1)
                            .maybeSingle();

                        if (existingLead) {
                            targetLeadId = existingLead.id;
                            const cf = typeof existingLead.custom_fields === 'string'
                                ? JSON.parse(existingLead.custom_fields || '{}')
                                : (existingLead.custom_fields || {});
                            if (forceNow) cf.allow_after_hours = true;
                            if (topicOrNotes) cf.call_objective = topicOrNotes;

                            const updatePayload: any = { custom_fields: cf };
                            if (topicOrNotes) updatePayload.notes = topicOrNotes;

                            await supabaseAdmin
                                .from('leads')
                                .update(updatePayload)
                                .eq('id', targetLeadId);
                        } else {
                            const formattedPhone = phoneToDial.startsWith('+') 
                                ? phoneToDial 
                                : (cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`);
                            const { data: createdLead } = await supabaseAdmin
                                .from('leads')
                                .insert({
                                    user_id: userId,
                                    name: 'Super Admin Test Call',
                                    phone: formattedPhone,
                                    source: 'WhatsApp Voice Test',
                                    notes: topicOrNotes || null,
                                    custom_fields: { allow_after_hours: true, call_objective: topicOrNotes || undefined }
                                })
                                .select('id')
                                .single();
                            if (createdLead) targetLeadId = createdLead.id;
                        }
                    } else if (topicOrNotes) {
                        await supabaseAdmin
                            .from('leads')
                            .update({ notes: topicOrNotes })
                            .eq('id', targetLeadId);
                    }

                    const res = await triggerOutboundCall(supabaseAdmin, targetLeadId, userId, false);
                    if (!res.success) return { success: false, error: res.error || 'Failed to initiate AI call' };
                    return {
                        success: true,
                        callSid: res.callSid,
                        message: res.scheduled ? 'Call scheduled for next calling window.' : 'AI Outbound call initiated! Phone is ringing.'
                    };
                } catch (e: any) {
                    return { success: false, error: e.message };
                }
            }
        }),

        // --- 4. META ADS & CAMPAIGNS ---
        get_account_campaigns: tool({
            description: "Fetches live Meta Ad Account campaigns, spend, and metrics from Meta Graph API.",
            inputSchema: z.object({
                limit: z.number().default(10)
            }),
            execute: async ({ limit }) => {
                const fbToken = profile?.facebook_token;
                const adAccountId = profile?.ad_account_id;

                if (fbToken && adAccountId) {
                    const cleanAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
                    const fbUrl = `https://graph.facebook.com/v19.0/${cleanAdAccountId}/campaigns?fields=id,name,status,effective_status,objective,start_time,insights{results,spend,actions}&limit=${limit}&access_token=${fbToken}`;
                    const fbRes = await fetch(fbUrl);
                    if (fbRes.ok) {
                        const fbData = await fbRes.json();
                        if (fbData.data && Array.isArray(fbData.data)) {
                            return fbData.data.map((c: any) => {
                                const ins = c.insights?.data?.[0] || {};
                                return {
                                    id: c.id,
                                    name: c.name,
                                    status: c.effective_status || c.status,
                                    spend: ins.spend || '0.00',
                                    results: ins.results?.[0]?.value || '0'
                                };
                            });
                        }
                    }
                }

                const { data: dbJobs } = await supabaseAdmin
                    .from('campaign_jobs')
                    .select('id, payload, status, created_at')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(limit);

                return (dbJobs || []).map((j: any) => ({
                    id: j.id,
                    name: j.payload?.campaign_name || 'Campaign Draft',
                    status: j.status,
                    budget: j.payload?.dailyBudget ? `₹${j.payload.dailyBudget}/day` : 'N/A'
                }));
            }
        }),

        launch_meta_instant_form_campaign: tool({
            description: "Launches a live Meta (Facebook/Instagram) ad campaign with target locations, daily budget, selected creatives, and an Instant Lead Form with custom questions.",
            inputSchema: z.object({
                campaignName: z.string().describe("Descriptive campaign title e.g. 'The Marq - Sector 54 Launch'"),
                campaignType: z.enum(['instant_form', 'whatsapp_chat', 'website']).default('instant_form'),
                dailyBudget: z.number().describe("Daily budget in INR (e.g. 2000)"),
                geographicRegions: z.array(z.string()).describe("Names of cities or regions e.g. ['Gurgaon', 'South Delhi']"),
                formQuestions: z.array(z.object({
                    label: z.string().describe("Question label e.g. 'Preferred Unit Type?'"),
                    type: z.enum(['MULTIPLE_CHOICE', 'SHORT_ANSWER']).default('MULTIPLE_CHOICE'),
                    options: z.array(z.string()).optional().describe("Choices for MULTIPLE_CHOICE e.g. ['2BHK', '3BHK', 'Penthouse']")
                })).optional().describe("Custom qualification questions to ask leads on the Meta instant form"),
                creativeAssetIds: z.array(z.string()).optional().describe("Asset IDs of creatives to use"),
                customInstructions: z.string().optional().describe("Specific ad copy instructions or pitch")
            }),
            execute: async ({ campaignName, campaignType, dailyBudget, geographicRegions, formQuestions, creativeAssetIds, customInstructions }) => {
                const fbToken = profile?.facebook_token || process.env.DEV_META_ACCESS_TOKEN;
                const adAccountId = profile?.ad_account_id || process.env.DEV_META_AD_ACCOUNT_ID;
                const pageId = profile?.selected_page_id || process.env.DEV_META_PAGE_ID;

                if (!fbToken || !adAccountId || !pageId) {
                    return { success: false, error: 'Meta advertising accounts are not connected for this profile.' };
                }

                const metaLocations = geographicRegions.map(reg => ({ name: reg, type: 'city', country: 'IN' }));
                const metaCustomQuestions = (formQuestions || []).map(q => ({
                    type: q.type === 'MULTIPLE_CHOICE' ? 'MULTIPLE_CHOICE' : 'CUSTOM',
                    label: q.label,
                    options: q.options || []
                }));

                const jobPayload: any = {
                    facebookToken: fbToken,
                    adAccountId: adAccountId.replace('act_', ''),
                    pageId,
                    selected_page_token: profile?.selected_page_token || null,
                    campaign_name: campaignName,
                    campaignType,
                    dailyBudget,
                    metaLocationsStr: JSON.stringify(metaLocations),
                    customQuestionsStr: JSON.stringify(metaCustomQuestions),
                    assetIds: creativeAssetIds || [],
                    businessName: profile?.business_name || 'Our Company',
                    contactNumber: profile?.contact_number || '',
                    privacyPolicyUrl: profile?.privacy_policy_url || 'https://adrolls.in/privacy',
                    customInstructions
                };

                const { data: job, error: jobErr } = await supabaseAdmin
                    .from('campaign_jobs')
                    .insert({ user_id: userId, status: 'pending', payload: jobPayload })
                    .select('id')
                    .single();

                if (jobErr || !job) {
                    return { success: false, error: jobErr?.message || 'Failed to create campaign job record' };
                }

                try {
                    const { runCampaignJob } = await import('@/utils/campaign-processor');
                    runCampaignJob(job.id, jobPayload).catch(e => console.error('[CAMPAIGN LAUNCH] Error:', e));
                } catch (e: any) {
                    console.warn('[CAMPAIGN LAUNCH] Async run error:', e.message);
                }

                return {
                    success: true,
                    jobId: job.id,
                    campaignName,
                    budget: `₹${dailyBudget}/day`,
                    regions: geographicRegions,
                    questionsConfigured: metaCustomQuestions.length,
                    message: `Meta instant form campaign '${campaignName}' successfully queued with ₹${dailyBudget}/day in ${geographicRegions.join(', ')} with ${metaCustomQuestions.length} custom qualifying questions.`
                };
            }
        }),

        list_facebook_lead_forms: tool({
            description: "Fetches live Meta Lead Forms from the connected Facebook Page.",
            inputSchema: z.object({}),
            execute: async () => {
                const fbToken = profile?.facebook_token || process.env.DEV_META_ACCESS_TOKEN;
                const pageId = profile?.selected_page_id || process.env.DEV_META_PAGE_ID;
                if (!fbToken || !pageId) return { error: 'No Facebook page connected.' };

                const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?fields=id,name,status,questions&access_token=${fbToken}`);
                if (!res.ok) return { error: 'Failed to fetch forms from Meta.' };
                const data = await res.json();
                return data.data || [];
            }
        }),

        open_creative_session_browser: tool({
            description: "Generates an interactive visual session browser link where the owner can view, preview, and select creatives on mobile.",
            inputSchema: z.object({
                productOrCampaignName: z.string().optional().describe("Specific campaign or product title")
            }),
            execute: async ({ productOrCampaignName }) => {
                const cleanPhone = (fromPhone || '').replace(/\D/g, '');
                const sessionToken = createCreativeSessionToken({ userId, phone: cleanPhone });
                let appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
                if (appUrl.includes('localhost') || appUrl.includes('local.nobogent.com')) {
                    appUrl = 'https://app.nobogent.com';
                }
                const sessionUrl = `${appUrl}/select-creatives?token=${sessionToken}`;
                return {
                    success: true,
                    sessionUrl,
                    instructionsForAgent: `Share this interactive session browser link with the owner: ${sessionUrl}. Mention that they can open it to visually preview, swipe through photos and videos, and multi-select or confirm their choices.`
                };
            }
        }),

        // --- 5. WHATSAPP & AUTOMATION TEMPLATES ---
        list_available_templates: tool({
            description: "Lists approved or pending WhatsApp message templates in Meta.",
            inputSchema: z.object({}),
            execute: async () => {
                const wabaId = profile?.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID;
                const token = profile?.whatsapp_access_token || profile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
                if (!wabaId || !token) return { error: 'No WhatsApp account connected' };

                const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=50&fields=name,status,category,components`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await res.json();
                return {
                    templates: (d.data || []).map((t: any) => ({
                        name: t.name,
                        status: t.status,
                        category: t.category,
                        hasImageHeader: t.components?.some((c: any) => c.type === 'HEADER' && c.format === 'IMAGE')
                    }))
                };
            }
        }),

        submit_whatsapp_template: tool({
            description: "Submits a new WhatsApp message template (with optional Image Header) to Meta for approval.",
            inputSchema: z.object({
                name: z.string().describe("Template name in lowercase_with_underscores"),
                category: z.enum(['MARKETING', 'UTILITY']).default('MARKETING'),
                bodyText: z.string().describe("The message text. Supports {{1}} variables."),
                headerImageUrl: z.string().optional().describe("URL of image sample for header if image template"),
                buttonText: z.string().optional().describe("Quick reply button text e.g. 'Interested', 'Book Visit'")
            }),
            execute: async ({ name, category, bodyText, headerImageUrl, buttonText }) => {
                const wabaId = profile?.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID;
                const token = profile?.whatsapp_access_token || profile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
                if (!wabaId || !token) return { success: false, error: 'No WhatsApp account connected' };

                const cleanName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                const components: any[] = [];
                if (headerImageUrl) {
                    components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [headerImageUrl] } });
                }
                components.push({ type: 'BODY', text: bodyText });
                if (buttonText) {
                    components.push({ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: buttonText }] });
                }

                const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: cleanName, category, language: 'en_US', components })
                });
                const metaRes = await res.json();
                if (metaRes.error) return { success: false, error: metaRes.error.message || 'Meta template submission error' };
                return { success: true, templateId: metaRes.id, status: 'PENDING_APPROVAL', name: cleanName };
            }
        }),

        get_whatsapp_performance: tool({
            description: "Get analytics on WhatsApp conversations: message counts, customer responses, and active chats.",
            inputSchema: z.object({}),
            execute: async () => {
                const { data: chats } = await supabaseAdmin
                    .from('whatsapp_chats')
                    .select('id, recipient_name, recipient_phone, last_message_text, updated_at')
                    .in('user_id', orgUserIds)
                    .order('updated_at', { ascending: false })
                    .limit(200);

                const orgChats = chats || [];
                const chatIds = orgChats.map(c => c.id);

                let inboundCount = 0;
                let outboundCount = 0;
                let recentCustomerReplies: string[] = [];

                if (chatIds.length > 0) {
                    const { data: messages } = await supabaseAdmin
                        .from('whatsapp_messages')
                        .select('direction, message_text, created_at')
                        .in('chat_id', chatIds.slice(0, 100))
                        .order('created_at', { ascending: false })
                        .limit(500);

                    const msgs = messages || [];
                    const inboundMsgs = msgs.filter(m => m.direction === 'inbound');
                    inboundCount = inboundMsgs.length;
                    outboundCount = msgs.filter(m => m.direction === 'outbound').length;
                    recentCustomerReplies = inboundMsgs.slice(0, 5).map(m => m.message_text).filter(Boolean);
                }

                const totalConversations = orgChats.length;
                const responseRate = outboundCount > 0 ? ((inboundCount / outboundCount) * 100).toFixed(1) : '0.0';

                return {
                    totalConversations,
                    totalInboundMessages: inboundCount,
                    totalOutboundMessages: outboundCount,
                    customerResponseRate: `${responseRate}%`,
                    recentCustomerReplies
                };
            }
        }),

        // --- 6. INVENTORY / CATALOG MANAGEMENT ---
        get_inventory_list: tool({
            description: "Fetches properties and inventory listings in the catalog.",
            inputSchema: z.object({
                search: z.string().optional().describe("Filter by title or address"),
                limit: z.number().default(10)
            }),
            execute: async ({ search, limit }) => {
                let q = supabaseAdmin
                    .from('properties')
                    .select('id, title, price, address, property_type, status, image_url')
                    .in('user_id', orgUserIds);
                if (search) q = q.ilike('title', `%${search}%`);
                const { data } = await q.limit(limit);
                return data || [];
            }
        }),

        add_inventory_item: tool({
            description: "Adds a new property or product listing to the inventory catalog (BLOCKED: Read-only access enforced).",
            inputSchema: z.object({
                title: z.string().describe("Property title"),
                price: z.string().describe("Price or price range"),
                address: z.string().describe("Location"),
                property_type: z.string().default('Generic'),
                description: z.string().optional(),
                image_urls: z.array(z.string()).optional()
            }),
            execute: async () => {
                return readOnlyRefusal;
            }
        }),

        attach_image_to_inventory: tool({
            description: "Attaches photo/creative to property inventory (BLOCKED: Read-only access enforced).",
            inputSchema: z.object({
                propertyIdOrTitle: z.string(),
                imageUrl: z.string().optional()
            }),
            execute: async () => {
                return readOnlyRefusal;
            }
        }),

        // --- 7. TASK STATUS, FEEDBACK & SELF-HEALING ---
        get_live_task_status: tool({
            description: "Gets real-time live execution status and milestone progress for recent tasks (Meta campaigns, voice campaigns, broadcasts).",
            inputSchema: z.object({
                taskType: z.enum(['all', 'meta_campaign', 'voice_campaign', 'whatsapp_broadcast']).default('all')
            }),
            execute: async ({ taskType }) => {
                const results: any = {};
                if (taskType === 'all' || taskType === 'meta_campaign') {
                    const { data: recentJobs } = await supabaseAdmin
                        .from('campaign_jobs')
                        .select('id, status, payload, created_at, updated_at')
                        .eq('user_id', userId)
                        .order('created_at', { ascending: false })
                        .limit(3);

                    results.recentCampaignJobs = (recentJobs || []).map(j => ({
                        jobId: j.id,
                        campaignName: j.payload?.campaign_name || 'Ad Campaign',
                        status: j.status,
                        budget: j.payload?.dailyBudget ? `₹${j.payload.dailyBudget}/day` : 'N/A',
                        startedAt: j.created_at
                    }));
                }

                if (taskType === 'all' || taskType === 'voice_campaign') {
                    const { data: recentCalls } = await supabaseAdmin
                        .from('call_logs')
                        .select('status')
                        .eq('user_id', userId)
                        .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());

                    const calls = recentCalls || [];
                    results.callingSummaryToday = {
                        totalCalls: calls.length,
                        connected: calls.filter(c => c.status === 'CONNECTED').length,
                        failedOrMissed: calls.filter(c => ['NOT_CONNECTED', 'FAILED', 'BUSY'].includes(c.status)).length
                    };
                }

                return results;
            }
        }),

        record_feedback_or_issue: tool({
            description: "Logs a user correction, complaint, dissatisfaction, or detected operational discrepancy into the Nobogent Engineering Feedback Engine.",
            inputSchema: z.object({
                category: z.enum(['CAMPAIGN_CREATION', 'VOICE_CALLING', 'WHATSAPP_MESSAGING', 'UNDERSTANDING_ERROR', 'TOOL_FAILURE', 'GENERAL']),
                discrepancy: z.string().describe("What went wrong, was misunderstood, or failed"),
                userCorrection: z.string().optional().describe("What the user actually specified or wanted"),
                suggestedFix: z.string().optional().describe("Immediate corrective action taken or proposed")
            }),
            execute: async ({ category, discrepancy, userCorrection, suggestedFix }) => {
                const res = await recordFeedbackOrIssue({
                    userId,
                    source: 'USER_CORRECTION',
                    category,
                    userPrompt: messageText,
                    discrepancy,
                    userCorrection,
                    suggestedFix
                });
                return {
                    success: true,
                    ticketNumber: res.ticketNumber,
                    message: `Issue logged under Ticket #${res.ticketNumber}. Registered for continuous improvement.`
                };
            }
        }),

        detect_and_analyze_anomalies: tool({
            description: "Scans recent call logs, WhatsApp outreach, and campaigns to detect operational anomalies or failures.",
            inputSchema: z.object({}),
            execute: async () => {
                const anomalies: any[] = [];
                const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
                const { data: recentCalls } = await supabaseAdmin
                    .from('call_logs')
                    .select('status, duration')
                    .eq('user_id', userId)
                    .gte('created_at', oneDayAgo)
                    .limit(30);

                const calls = recentCalls || [];
                if (calls.length >= 5) {
                    const failed = calls.filter(c => ['NOT_CONNECTED', 'REJECTED', 'FAILED', 'BUSY'].includes(c.status) || c.duration === 0);
                    const rate = (failed.length / calls.length) * 100;
                    if (rate >= 60) {
                        anomalies.push({
                            component: 'VOICE_CALLING',
                            severity: 'HIGH',
                            title: 'High Call Drop Rate',
                            description: `Failure rate is ${rate.toFixed(0)}% in recent calls.`,
                            recommendedAction: 'PAUSE_AND_REQUEUE_CALLS'
                        });
                    }
                }

                return { healthy: anomalies.length === 0, anomalies };
            }
        }),

        execute_self_healing: tool({
            description: "Executes an autonomous self-healing remediation action (BLOCKED: Read-only access enforced).",
            inputSchema: z.object({
                actionType: z.enum(['PAUSE_AND_REQUEUE_CALLS', 'DISABLE_CALLING_POLICY', 'RESET_LEAD_QUEUE', 'ENABLE_CALLING_POLICY']),
                reason: z.string()
            }),
            execute: async () => {
                return readOnlyRefusal;
            }
        }),

        update_agent_policy: tool({
            description: "Update autonomous agent policies (BLOCKED: Read-only access enforced).",
            inputSchema: z.object({
                callingEnabled: z.boolean().optional(),
                contactIntensity: z.enum(['low', 'medium', 'high']).optional(),
                businessHoursStart: z.string().optional(),
                businessHoursEnd: z.string().optional()
            }),
            execute: async () => {
                return readOnlyRefusal;
            }
        })
    };

    let result: any;
    try {
        result = await generateText({
            model: getLLMModel(),
            system: systemPrompt,
            prompt: promptText,
            stopWhen: stepCountIs(10),
            tools
        });
    } catch (llmErr: any) {
        console.warn('[OWNER ORCHESTRATOR] Primary LLM failed, retrying with Gemini fallback:', llmErr?.message || llmErr);
        result = await generateText({
            model: google('gemini-2.5-flash'),
            system: systemPrompt,
            prompt: promptText,
            stopWhen: stepCountIs(10),
            tools
        });
    }

    const finalText = (result?.text || '').trim();
    const fallbackText = "I have processed your request and crunched the organization metrics. Please let me know if you would like more detailed breakdowns or downloadable exports.";
    const responsePayload: OwnerBotResponse = {
        text: finalText || fallbackText,
        mediaAttachments
    };
    (responsePayload as any).toString = () => responsePayload.text;
    return responsePayload;
}

/**
 * Generates the Morning Executive Briefing text for 9:00 AM dispatch.
 */
export async function generateDailyMorningBriefing(userId: string): Promise<string> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [leadsToday, visitsToday] = await Promise.all([
        supabaseAdmin.from('leads').select('*', { count: 'exact', head: true }).eq('assigned_to', userId).gte('created_at', today.toISOString()),
        supabaseAdmin.from('leads').select('name, booked_time').eq('assigned_to', userId).gte('booked_time', today.toISOString()).lte('booked_time', new Date(today.getTime() + 24 * 3600 * 1000).toISOString())
    ]);

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('business_name')
        .eq('id', userId)
        .single();

    const name = profile?.business_name || 'Team';
    const visits = visitsToday.data || [];

    return `Good morning ${name}! ☀️ Here is your Nobogent update for today:\n\n• New Leads: ${leadsToday.count || 0}\n• Scheduled Visits Today: ${visits.length}\n${visits.map((v: any) => `  - ${v.name}: ${new Date(v.booked_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`).join('\n')}\n\nOur autonomous agent will commence outreach at 10:00 AM. Let me know if you would like to pause or adjust any settings!`;
}
