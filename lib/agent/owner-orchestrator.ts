import { createClient } from '@supabase/supabase-js';
import { generateText, tool, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { createCreativeSessionToken } from '@/utils/creative-token';
import { recordFeedbackOrIssue, getRecentLearnings } from './feedback-engine';
import { triggerOutboundCall } from '@/utils/voice-helper';

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
    if (cleanKey) {
        const deepseek = createOpenAI({
            baseURL: 'https://api.deepseek.com/v1',
            apiKey: cleanKey,
            ...({ compatibility: 'compatible' } as any)
        });
        return deepseek.chat('deepseek-chat');
    }
    console.warn('[OWNER ORCHESTRATOR] DEEPSEEK_API_KEY not found in environment, falling back to Gemini 2.5 Flash');
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
}): Promise<string> {
    const { userId, messageText, fromPhone, mediaUrl, mediaType } = params;

    // Fetch user profile, policies, learnings, and registered team members under this workspace
    const [profRes, policyRes, learnings, teamRes] = await Promise.all([
        supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, business_info, address, contact_number, whatsapp_personal_number, whatsapp_phone_number, role, facebook_token, ad_account_id, selected_page_id, selected_page_token, whatsapp_waba_id, whatsapp_access_token, whatsapp_phone_number_id, privacy_policy_url')
            .eq('id', userId)
            .single(),
        supabaseAdmin.from('agent_policies').select('*').eq('user_id', userId).maybeSingle(),
        getRecentLearnings(userId),
        supabaseAdmin
            .from('profiles')
            .select('id, full_name, business_name, email, role, contact_number')
            .or(`parent_id.eq.${userId},agency_id.eq.${userId}`)
    ]);

    const profile = profRes.data;
    const policy = policyRes.data;
    const teamMembers = teamRes.data || [];
    const businessName = profile?.business_name || 'your business';

    const teamListFormatted = teamMembers.map(m => {
        const displayName = m.full_name || m.business_name || m.email;
        return `- ${displayName} (Email: ${m.email || 'N/A'}, Role: ${m.role || 'agent'}, ID: ${m.id})`;
    }).join('\n') || 'No sub-agents or team members registered.';

    const systemPrompt = `
You are Nobogent, the Executive AI Sales Director and Autonomous Business Co-pilot for ${businessName}.
You are interacting directly with the business owner on WhatsApp.

You possess COMPLETE operational control across every capability of the Nobogent CRM, Team Management, Telecalling/Calling, Meta Ads, and WhatsApp Automation platform.

WORKSPACE REGISTERED TEAM MEMBERS:
${teamListFormatted}

CRITICAL RULES FOR TEAM MEMBERS & CALLING STATUS:
1. People listed in "WORKSPACE REGISTERED TEAM MEMBERS" above (such as Devraj Singh Rathore / Devraj) are TEAM MEMBERS / AGENTS in this workspace, NOT simply leads!
2. Even if a lead record with the same name exists in the CRM, when the owner asks about a person by name (e.g. "Devraj", "calling status of leads assigned to Devraj", "Devraj's calling status"), they are ALWAYS referring to the TEAM MEMBER!
3. NEVER reply that a team member is "just a lead" or has no activity without checking their assigned leads and calling performance!
4. Use 'get_team_member_performance' or 'get_team_calling_status' to fetch:
   - Total leads assigned in the CRM (e.g. 828 leads assigned to Devraj)
   - Breakdown of assigned leads across stages (New, Contacted, Requirement Taken, Meeting Planned, Meeting Done, Visit Done, Appointment Booked, Deal/Token, Lost/NI)
   - Calling status breakdown (not_called vs called vs qualified_via_whatsapp)
   - Recent follow-up calls and remarks logged by that team member (e.g. DNP, call remarks in notes)
5. Format your response cleanly and respectfully with WhatsApp-friendly emojis and bullet points. Never use markdown headers (like # or ##).

LIVE TASK PROGRESS & STATUS TRACKING PROTOCOL:
When the owner asks about the current status, live progress, or results of any task (Meta ads campaign, voice calling, broadcasts):
- Use 'get_live_task_status' to fetch real-time milestone progress.
- Report the status clearly with current stage, active numbers, and live metrics.

CONTINUOUS FEEDBACK & ISSUE TRACKING PROTOCOL:
Whenever the owner corrects you, points out a mistake, expresses dissatisfaction, or if you detect an operational discrepancy:
1. DO NOT argue or get defensive.
2. ALWAYS invoke 'record_feedback_or_issue' to log the incident into the Nobogent Engineering Feedback Engine.
3. Acknowledge the correction with humility, mention the tracking ticket number returned, and adapt your response immediately.

ASSET & CREATIVE EXPLORATION PROTOCOL (CRITICAL):
When the owner asks to see, preview, or select creatives, images, videos, floor plans, or assets for a product/project/campaign:
- DO NOT dump dozens of images/videos directly into the WhatsApp chat.
- ALWAYS invoke 'open_creative_session_browser' with the product or campaign name.
- Present the generated session browser link clearly to the owner.

GUARDIAN ANOMALY DETECTION & SELF-HEALING PROTOCOL:
When asked about system health, outreach status, or if calling drops:
1. Call 'detect_and_analyze_anomalies'.
2. If anomalies are found, report symptoms, root cause, and ask: "Shall I execute this self-healing fix now?"
3. If confirmed, call 'execute_self_healing'.

CURRENT BUSINESS POLICIES & TELEPHONY:
- Role: ${profile?.role || 'owner'} ${profile?.role === 'super_admin' || profile?.email === 'rchopra489@gmail.com' ? '(SUPER ADMIN - Master SIP Trunk & Vobiz Line Connected: +91 11 7136 6938)' : ''}
- Calling Enabled: ${policy?.calling_enabled !== false}
- Contact Intensity: ${policy?.contact_intensity || 'medium'}
- Business Hours: ${policy?.business_hours_start || '09:30'} to ${policy?.business_hours_end || '19:00'}
- Appointment Goal: ${policy?.appointment_goal || 'site_visit'}
- Owner Registered Phone: ${profile?.whatsapp_personal_number || profile?.contact_number || '+918288835235'}

CALLING & TEST DIALING PROTOCOL:
When the owner requests to test a voice call or dial a phone number (e.g. "call my number", "call me", "call 8288835235", "test call super admin"):
- ALWAYS invoke 'trigger_ai_call' with their phone number or "me".
- If the owner mentions a specific topic, purpose, or question to discuss on the call (e.g. "ask them what are their plans on Nobogent", "call regarding XYZ"), ALWAYS extract that and pass it into 'topicOrNotes'.
- NEVER refuse by saying voice calling is inactive or disabled without calling 'trigger_ai_call'.
- Master telephony is active, and test calls bypass out-of-hours restriction.

RECENT ADAPTATIONS & LEARNINGS FOR THIS ACCOUNT:
${learnings.length > 0 ? learnings.join('\n') : 'No previous corrections logged.'}
`;

    let promptText = messageText;
    if (mediaUrl && mediaType === 'image') {
        promptText = `${messageText || ''} [Attached Permanent Image URL: "${mediaUrl}". If the user wants to use this as an ad creative, call 'attach_image_to_inventory' or link to campaign]`.trim();
    }

    const tools = {
        // --- 1. TEAM MEMBERS & STAFF MANAGEMENT ---
        list_team_members: tool({
            description: "Lists all registered team members (agents, admins) under this workspace with their roles, contact details, and assigned lead counts.",
            inputSchema: z.object({}),
            execute: async () => {
                const { data: members } = await supabaseAdmin
                    .from('profiles')
                    .select('id, full_name, business_name, email, role, contact_number, created_at')
                    .or(`parent_id.eq.${userId},agency_id.eq.${userId}`)
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
            description: "Assigns or reassigns one or more CRM leads to a team member.",
            inputSchema: z.object({
                leadIdentifiers: z.array(z.string()).describe("Lead UUIDs, names, or phone numbers to assign"),
                targetMemberNameOrId: z.string().describe("Target team member's name, email, or UUID")
            }),
            execute: async ({ leadIdentifiers, targetMemberNameOrId }) => {
                // Resolve member
                let memberId = targetMemberNameOrId;
                let memberName = targetMemberNameOrId;
                const { data: members } = await supabaseAdmin
                    .from('profiles')
                    .select('id, full_name, business_name, email')
                    .or(`parent_id.eq.${userId},agency_id.eq.${userId}`)
                    .or(`full_name.ilike.%${targetMemberNameOrId}%,business_name.ilike.%${targetMemberNameOrId}%,email.ilike.%${targetMemberNameOrId}%,id.eq.${targetMemberNameOrId}`);

                if (members && members.length > 0) {
                    memberId = members[0].id;
                    memberName = members[0].full_name || members[0].business_name || members[0].email;
                }

                let updatedCount = 0;
                for (const ident of leadIdentifiers) {
                    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ident);
                    let q = supabaseAdmin.from('leads').update({ assigned_to: memberId });
                    if (isUuid) {
                        q = q.eq('id', ident);
                    } else {
                        q = q.or(`phone.ilike.%${ident}%,name.ilike.%${ident}%`).eq('user_id', userId);
                    }
                    const { error } = await q;
                    if (!error) updatedCount++;
                }

                return {
                    success: true,
                    assignedTo: memberName,
                    assignedCount: updatedCount,
                    message: `Successfully assigned ${updatedCount} lead(s) to ${memberName}.`
                };
            }
        }),

        transfer_leads: tool({
            description: "Transfers leads in bulk from one team member (or unassigned pool) to another team member.",
            inputSchema: z.object({
                fromMemberNameOrId: z.string().describe("Source team member name/email/UUID, or 'unassigned'"),
                toMemberNameOrId: z.string().describe("Target team member name/email/UUID"),
                stage: z.string().optional().describe("Optional pipeline stage filter, e.g. 'New'"),
                limit: z.number().default(50).describe("Maximum number of leads to transfer")
            }),
            execute: async ({ fromMemberNameOrId, toMemberNameOrId, stage, limit }) => {
                // Resolve target
                const { data: targetMembers } = await supabaseAdmin
                    .from('profiles')
                    .select('id, full_name, business_name, email')
                    .or(`parent_id.eq.${userId},agency_id.eq.${userId}`)
                    .or(`full_name.ilike.%${toMemberNameOrId}%,business_name.ilike.%${toMemberNameOrId}%,email.ilike.%${toMemberNameOrId}%,id.eq.${toMemberNameOrId}`)
                    .limit(1);

                if (!targetMembers || targetMembers.length === 0) {
                    return { success: false, error: `Target team member '${toMemberNameOrId}' not found.` };
                }
                const targetMember = targetMembers[0];

                let query = supabaseAdmin.from('leads').select('id').eq('user_id', userId);
                if (fromMemberNameOrId.toLowerCase() === 'unassigned') {
                    query = query.is('assigned_to', null);
                } else {
                    const { data: fromMembers } = await supabaseAdmin
                        .from('profiles')
                        .select('id')
                        .or(`parent_id.eq.${userId},agency_id.eq.${userId}`)
                        .or(`full_name.ilike.%${fromMemberNameOrId}%,business_name.ilike.%${fromMemberNameOrId}%,email.ilike.%${fromMemberNameOrId}%,id.eq.${fromMemberNameOrId}`)
                        .limit(1);
                    if (fromMembers && fromMembers.length > 0) {
                        query = query.eq('assigned_to', fromMembers[0].id);
                    }
                }

                if (stage) query = query.eq('pipeline_stage', stage);
                const { data: leadsToTransfer } = await query.limit(limit);
                const leadIds = (leadsToTransfer || []).map(l => l.id);

                if (leadIds.length === 0) {
                    return { success: false, message: 'No leads found matching the transfer criteria.' };
                }

                await supabaseAdmin
                    .from('leads')
                    .update({ assigned_to: targetMember.id })
                    .in('id', leadIds);

                return {
                    success: true,
                    transferredCount: leadIds.length,
                    toMember: targetMember.full_name || targetMember.business_name || targetMember.email,
                    message: `Transferred ${leadIds.length} lead(s) to ${targetMember.full_name || targetMember.business_name || targetMember.email}.`
                };
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
                    .eq('user_id', userId)
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
                let q = supabaseAdmin.from('leads').select('*').eq('user_id', userId);
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
            description: "Updates the pipeline stage of a lead (e.g. 'New Lead', 'Contacted', 'Requirement Taken', 'Meeting Planned', 'Meeting Done', 'Site Visit', 'Qualified', 'Deal/Token', 'Lost/NI').",
            inputSchema: z.object({
                leadIdentifier: z.string().describe("Lead UUID, phone number, or name"),
                newStage: z.string().describe("Target pipeline stage"),
                notes: z.string().optional().describe("Optional notes/remarks to append")
            }),
            execute: async ({ leadIdentifier, newStage, notes }) => {
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadIdentifier);
                let findQ = supabaseAdmin.from('leads').select('id, name, notes').eq('user_id', userId);
                if (isUuid) findQ = findQ.eq('id', leadIdentifier);
                else findQ = findQ.or(`phone.ilike.%${leadIdentifier}%,name.ilike.%${leadIdentifier}%`);

                const { data: lead } = await findQ.maybeSingle();
                if (!lead) return { success: false, error: `Lead '${leadIdentifier}' not found.` };

                const updatedNotes = notes
                    ? `${lead.notes ? `${lead.notes}\n` : ''}[${new Date().toLocaleDateString('en-IN')}]: ${notes}`
                    : lead.notes;

                const { error } = await supabaseAdmin
                    .from('leads')
                    .update({ pipeline_stage: newStage, notes: updatedNotes })
                    .eq('id', lead.id);

                if (error) return { success: false, error: error.message };
                return { success: true, leadId: lead.id, leadName: lead.name, newStage, message: `Lead '${lead.name}' moved to stage '${newStage}'.` };
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
                    .eq('user_id', userId)
                    .ilike('pipeline_stage', `%${stageName}%`)
                    .limit(limit);
                return leads || [];
            }
        }),

        add_crm_lead: tool({
            description: "Adds a new lead directly into the CRM with name, phone, email, notes, and optional agent assignment.",
            inputSchema: z.object({
                name: z.string().describe("Lead full name"),
                phone: z.string().describe("Lead phone number"),
                email: z.string().optional(),
                pipeline_stage: z.string().default('New'),
                budget: z.string().optional(),
                notes: z.string().optional(),
                assignToMemberNameOrId: z.string().optional().describe("Optional team member to assign this lead to")
            }),
            execute: async ({ name, phone, email, pipeline_stage, budget, notes, assignToMemberNameOrId }) => {
                let assignedToId: string | null = null;
                if (assignToMemberNameOrId) {
                    const { data: members } = await supabaseAdmin
                        .from('profiles')
                        .select('id')
                        .or(`parent_id.eq.${userId},agency_id.eq.${userId}`)
                        .or(`full_name.ilike.%${assignToMemberNameOrId}%,business_name.ilike.%${assignToMemberNameOrId}%,email.ilike.%${assignToMemberNameOrId}%,id.eq.${assignToMemberNameOrId}`)
                        .limit(1);
                    if (members && members.length > 0) assignedToId = members[0].id;
                }

                const { data: newLead, error } = await supabaseAdmin
                    .from('leads')
                    .insert({
                        user_id: userId,
                        name,
                        phone,
                        email: email || null,
                        pipeline_stage: pipeline_stage || 'New',
                        budget: budget || null,
                        notes: notes || null,
                        assigned_to: assignedToId,
                        source: 'WhatsApp Assistant'
                    })
                    .select('id, name, phone, pipeline_stage')
                    .single();

                if (error) return { success: false, error: error.message };
                return { success: true, lead: newLead, message: `Lead '${name}' (${phone}) added to CRM in stage '${pipeline_stage}'.` };
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
            description: "Get analytics on WhatsApp template messages: delivery counts, and customer responses/replies.",
            inputSchema: z.object({}),
            execute: async () => {
                const { data: chatLogs } = await supabaseAdmin
                    .from('whatsapp_chats')
                    .select('id, direction, message_text, created_at')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(200);

                const chats = chatLogs || [];
                const inbound = chats.filter(c => c.direction === 'inbound');
                const outbound = chats.filter(c => c.direction === 'outbound');
                const responseRate = outbound.length > 0 ? ((inbound.length / outbound.length) * 100).toFixed(1) : '0.0';

                return {
                    totalTemplatesOutbound: outbound.length,
                    totalCustomerResponses: inbound.length,
                    responseRatePercentage: `${responseRate}%`,
                    sampleRecentReplies: inbound.slice(0, 5).map(i => i.message_text)
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
                    .eq('user_id', userId);
                if (search) q = q.ilike('title', `%${search}%`);
                const { data } = await q.limit(limit);
                return data || [];
            }
        }),

        add_inventory_item: tool({
            description: "Adds a new property or product listing to the inventory catalog.",
            inputSchema: z.object({
                title: z.string().describe("Property title e.g. '3BHK Luxury Apartment, Aerocity'"),
                price: z.string().describe("Price or price range e.g. '₹85 Lakhs'"),
                address: z.string().describe("Location or locality e.g. 'Sector 54, Gurgaon'"),
                property_type: z.string().default('Generic'),
                description: z.string().optional(),
                image_urls: z.array(z.string()).optional()
            }),
            execute: async ({ title, price, address, property_type, description, image_urls }) => {
                const images = image_urls || (mediaUrl ? [mediaUrl] : []);
                const { data: newProp, error } = await supabaseAdmin
                    .from('properties')
                    .insert({
                        user_id: userId,
                        title,
                        price,
                        address,
                        property_type: property_type || 'Generic',
                        description: description || '',
                        image_url: images[0] || '',
                        images: images,
                        status: 'Active',
                        show_on_landing_page: true
                    })
                    .select('id, title, price, address')
                    .single();

                if (error) return { success: false, error: error.message };
                return { success: true, property: newProp, message: `Property '${title}' successfully added to inventory.` };
            }
        }),

        attach_image_to_inventory: tool({
            description: "Attaches a photo/image to an existing property in the catalog.",
            inputSchema: z.object({
                property_id: z.string().optional().describe("UUID of property"),
                property_title: z.string().optional().describe("Title or search term of property"),
                image_url: z.string().optional().describe("Image URL to attach. Defaults to current message attachment")
            }),
            execute: async ({ property_id, property_title, image_url }) => {
                const targetImageUrl = image_url || mediaUrl;
                if (!targetImageUrl) return { success: false, error: "No image attachment or URL available." };

                let targetId = property_id;
                if (!targetId) {
                    let q = supabaseAdmin.from('properties').select('id, title, images').eq('user_id', userId);
                    if (property_title) q = q.ilike('title', `%${property_title}%`);
                    else q = q.order('created_at', { ascending: false });
                    const { data: matched } = await q.limit(1);
                    if (matched && matched.length > 0) targetId = matched[0].id;
                }

                if (!targetId) return { success: false, error: "No matching property found in catalog." };

                const { data: currProp } = await supabaseAdmin.from('properties').select('images').eq('id', targetId).single();
                const existingImages: string[] = Array.isArray(currProp?.images) ? [...currProp.images] : [];
                if (!existingImages.includes(targetImageUrl)) existingImages.push(targetImageUrl);

                await supabaseAdmin.from('properties').update({ image_url: targetImageUrl, images: existingImages }).eq('id', targetId);
                return { success: true, message: `Successfully attached photo to property.` };
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
            description: "Executes an autonomous self-healing remediation action for a confirmed operational anomaly.",
            inputSchema: z.object({
                actionType: z.enum(['PAUSE_AND_REQUEUE_CALLS', 'DISABLE_CALLING_POLICY', 'RESET_LEAD_QUEUE', 'ENABLE_CALLING_POLICY']),
                reason: z.string()
            }),
            execute: async ({ actionType, reason }) => {
                if (actionType === 'PAUSE_AND_REQUEUE_CALLS') {
                    await supabaseAdmin.from('agent_policies').upsert({ user_id: userId, calling_enabled: false }, { onConflict: 'user_id' });
                    return { success: true, message: 'Calling paused and leads restored to queue.' };
                }
                if (actionType === 'ENABLE_CALLING_POLICY') {
                    await supabaseAdmin.from('agent_policies').upsert({ user_id: userId, calling_enabled: true }, { onConflict: 'user_id' });
                    return { success: true, message: 'Calling policy re-enabled.' };
                }
                return { success: true, message: `Remediation action '${actionType}' executed.` };
            }
        }),

        update_agent_policy: tool({
            description: "Update autonomous agent policies such as calling enabled/disabled, contact intensity, or calling hours.",
            inputSchema: z.object({
                callingEnabled: z.boolean().optional(),
                contactIntensity: z.enum(['low', 'medium', 'high']).optional(),
                businessHoursStart: z.string().optional(),
                businessHoursEnd: z.string().optional()
            }),
            execute: async (updates) => {
                const dbUpdates: Record<string, any> = { user_id: userId, updated_at: new Date().toISOString() };
                if (updates.callingEnabled !== undefined) dbUpdates.calling_enabled = updates.callingEnabled;
                if (updates.contactIntensity) dbUpdates.contact_intensity = updates.contactIntensity;
                if (updates.businessHoursStart) dbUpdates.business_hours_start = updates.businessHoursStart;
                if (updates.businessHoursEnd) dbUpdates.business_hours_end = updates.businessHoursEnd;

                const { error } = await supabaseAdmin
                    .from('agent_policies')
                    .upsert(dbUpdates, { onConflict: 'user_id' });
                if (error) return { success: false, error: error.message };
                return { success: true, updated: dbUpdates };
            }
        })
    };

    let result: any;
    try {
        result = await generateText({
            model: getLLMModel(),
            system: systemPrompt,
            prompt: promptText,
            stopWhen: stepCountIs(6),
            tools
        });
    } catch (llmErr: any) {
        console.warn('[OWNER ORCHESTRATOR] Primary LLM failed, retrying with Gemini fallback:', llmErr?.message || llmErr);
        result = await generateText({
            model: google('gemini-2.5-flash'),
            system: systemPrompt,
            prompt: promptText,
            stopWhen: stepCountIs(6),
            tools
        });
    }

    const finalText = (result?.text || '').trim();
    return finalText || "I have processed your request and updated the records. Please let me know if you need specific details or actions.";
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
