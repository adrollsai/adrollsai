import { createClient } from '@supabase/supabase-js';
import { generateText, tool, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import * as AgentTools from './tools';
import { refreshWhatsAppWindow, fulfillPendingDeliveriesIfAny, isWhatsAppWindowOpen } from './whatsapp-policy';
import { fastTriageInboundMessage } from './faq-cache';

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
        return deepseek.chat('deepseek-chat'); // DeepSeek v4.1-Flash via /chat/completions
    }
    console.warn('[ORCHESTRATOR] DEEPSEEK_API_KEY not found in environment, falling back to Gemini 2.5 Flash');
    return google('gemini-2.5-flash');
}

export interface OrchestrationEvent {
    eventType: 'LEAD_CREATED' | 'MESSAGE_RECEIVED' | 'CALL_COMPLETED' | 'RE_EVALUATE' | 'WATCHDOG_CHECK' | 'MANUAL_IMPORT';
    leadId: string;
    inboundText?: string;
    metadata?: any;
}

/**
 * The core brain that evaluates a lead, decides the next best action, and executes it.
 */
export async function processLeadEvent(event: OrchestrationEvent): Promise<{ success: boolean; actionTaken?: string; error?: string }> {
    const { leadId, eventType, inboundText } = event;

    // 1. Acquire Concurrency Lock (prevents race conditions from parallel webhooks)
    const now = new Date();
    const lockExpiry = new Date(now.getTime() + 45 * 1000); // 45s lock

    const { data: leadRecord, error: fetchErr } = await supabaseAdmin
        .from('leads')
        .select('id, name, phone, assigned_to, autonomous_status, processing_lock_until, whatsapp_window_expires_at')
        .eq('id', leadId)
        .single();

    if (fetchErr || !leadRecord) {
        return { success: false, error: 'Lead not found' };
    }

    const userId = leadRecord.assigned_to;
    if (!userId) {
        return { success: true, actionTaken: 'lead_unassigned' };
    }

    // Safety Guard: Check if the user has explicitly enabled the autonomous sales agent
    const { data: policy } = await supabaseAdmin
        .from('agent_policies')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (!policy || policy.is_enabled !== true) {
        // Autonomous agent is not activated for this user. Leave existing workflows 100% untouched.
        return { success: true, actionTaken: 'agent_not_enabled_for_user' };
    }

    if (leadRecord.processing_lock_until && new Date(leadRecord.processing_lock_until).getTime() > now.getTime()) {
        console.log(`[ORCHESTRATOR] Lead ${leadId} is currently being processed by another worker. Skipping.`);
        return { success: true, actionTaken: 'locked_skipped' };
    }

    // Set lock
    await supabaseAdmin
        .from('leads')
        .update({ processing_lock_until: lockExpiry.toISOString() })
        .eq('id', leadId);

    try {
        // 2. If this was an inbound customer message:
        if (eventType === 'MESSAGE_RECEIVED') {
            await refreshWhatsAppWindow(leadId);

            // Fast Heuristic Triage (Opt-outs, Handshakes) without LLM latency & token cost
            const triage = await fastTriageInboundMessage(leadId, inboundText || '');
            if (triage.handled) {
                await supabaseAdmin
                    .from('leads')
                    .update({ 
                        processing_lock_until: null,
                        last_agent_thought: triage.actionSummary || 'Handled via fast triage'
                    })
                    .eq('id', leadId);
                return { success: true, actionTaken: triage.actionSummary };
            }
        }

        // 3. Gather Context
        const contextRes = await AgentTools.getLeadContext(leadId);
        if (!contextRes.success || !contextRes.data) {
            throw new Error(contextRes.error || 'Failed to gather lead context');
        }
        const { lead, is24hWindowOpen: windowOpen, recentChats, recentCallLogs } = contextRes.data;

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('business_name, business_info')
            .eq('id', userId)
            .single();

        const businessName = profile?.business_name || 'Our Company';
        const businessInfo = profile?.business_info || 'Real estate & customer consultation';
        const contactIntensity = policy?.contact_intensity || 'medium';
        const appointmentGoal = policy?.appointment_goal || 'site_visit';

        // 4. Construct System Prompt & Instructions
        const systemPrompt = `
You are the Senior Autonomous Sales & Appointment Setting Agent for ${businessName}.
Your objective is to guide leads through a natural consultative journey from initial discovery to booking a ${appointmentGoal.replace('_', ' ')}.

CORE OPERATING PRINCIPLES:
1. CONSULTATIVE, NEVER PUSHY: Answer questions clearly. Suggest useful information (payment plans, location, layouts) that buyers care about. Only propose a ${appointmentGoal.replace('_', ' ')} when there is mutual relevance.
2. DISCOVERY FIRST: If the lead has no known requirements or budget, start in DISCOVERY MODE: ask a friendly, low-pressure question about what they are exploring.
3. CONVERSATIONAL PROGRESSION:
   - Lead is blank/new -> Discover requirements
   - Lead has requirement -> Provide relevant matching offerings & details
   - Lead engaged -> Offer 2 specific slots for a ${appointmentGoal.replace('_', ' ')}
   - Lead says "call me later / travelling" -> Schedule a future re-evaluation via 'schedule_next_evaluation'
4. WHATSAPP CONSTRAINTS:
   - 24-Hour Customer Window is currently: ${windowOpen ? 'OPEN (Free-form text & media allowed)' : 'CLOSED (Use templates or handshake)'}.
5. EXIT CRITERIA:
   - If lead says "Not interested", "Stop", or "Wrong number" -> Call 'update_lead_profile' with stage 'STOPPED' and do not contact again.

LEAD CONTEXT:
Name: ${lead.name || 'Unknown (Blank Contact)'}
Phone: ${lead.phone || 'Unknown'}
Budget: ${lead.budget || 'Not specified'}
Timeline: ${lead.timeline || 'Not specified'}
Current Stage: ${lead.pipeline_stage || lead.autonomous_status || 'NEW'}
Notes: ${lead.notes || 'None'}
Last Summary: ${lead.summary || 'None'}

RECENT WHATSAPP TURNS:
${recentChats.length > 0 ? recentChats.map((c: any) => `[${c.direction === 'inbound' ? 'LEAD' : 'AGENT'}]: ${c.message_text}`).join('\n') : 'No recent chat history.'}

RECENT CALL LOGS:
${recentCallLogs.length > 0 ? recentCallLogs.map((c: any) => `Call: ${c.status} (${c.duration_seconds}s) Notes: ${c.notes || 'none'}`).join('\n') : 'No previous calls.'}

CURRENT TRIGGER EVENT: ${eventType}
${inboundText ? `LATEST INBOUND MESSAGE FROM LEAD: "${inboundText}"` : ''}
`;

        // 5. Invoke LLM with Tools
        const result = await generateText({
            model: getLLMModel(),
            system: systemPrompt,
            prompt: `Evaluate the current state of lead ${lead.name || lead.phone}. Decide the best action, invoke the required tools, and summarize your reasoning.`,
            stopWhen: stepCountIs(6),
            tools: {
                search_offerings: tool({
                    description: "Search for matching properties, units, or products in the business catalog.",
                    inputSchema: z.object({
                        query: z.string().describe("Search keywords like 3BHK, villa, budget, location"),
                        maxPrice: z.number().optional().describe("Maximum price in INR if known")
                    }),
                    execute: async ({ query, maxPrice }) => {
                        return await AgentTools.searchOfferings({ userId, query, maxPrice });
                    }
                }),

                get_available_slots: tool({
                    description: "Get open calendar appointment slots for booking a site visit or consultation.",
                    inputSchema: z.object({
                        targetDateStr: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to tomorrow)")
                    }),
                    execute: async ({ targetDateStr }) => {
                        return await AgentTools.getAvailableSlots({ userId, targetDateStr });
                    }
                }),

                book_appointment_slot: tool({
                    description: "Locks and books a confirmed appointment slot for the lead.",
                    inputSchema: z.object({
                        slotIso: z.string().describe("ISO datetime string of the selected slot"),
                        notes: z.string().optional().describe("Specific customer preferences or visit requirements")
                    }),
                    execute: async ({ slotIso, notes }) => {
                        return await AgentTools.bookAppointmentSlot({ leadId, slotIso, notes });
                    }
                }),

                send_whatsapp_message: tool({
                    description: "Sends a conversational WhatsApp message or brochure to the lead.",
                    inputSchema: z.object({
                        text: z.string().describe("The message to send to the lead"),
                        mediaUrl: z.string().optional().describe("Optional URL of a brochure or layout image to attach")
                    }),
                    execute: async ({ text, mediaUrl }) => {
                        return await AgentTools.requestWhatsAppDelivery({
                            leadId,
                            itemsToDeliver: mediaUrl ? [{ type: 'brochure' }] : [],
                            note: text
                        });
                    }
                }),

                schedule_next_evaluation: tool({
                    description: "Schedules a future wake-up timer for the agent to re-evaluate this lead (e.g. after 2 days or on a specific date).",
                    inputSchema: z.object({
                        scheduledForIso: z.string().describe("ISO datetime string when the agent should wake up"),
                        reason: z.string().describe("Why the evaluation is scheduled for this time")
                    }),
                    execute: async ({ scheduledForIso, reason }) => {
                        return await AgentTools.scheduleNextEvaluation({ leadId, userId, scheduledForIso, reason });
                    }
                }),

                trigger_outbound_voice_call: tool({
                    description: "Triggers an outbound conversational AI phone call to the lead if appropriate under policy.",
                    inputSchema: z.object({
                        reason: z.string().describe("Reason for calling the lead")
                    }),
                    execute: async ({ reason }) => {
                        return await AgentTools.triggerOutboundVoiceCall({ leadId, profileId: userId, reason });
                    }
                }),

                update_lead_profile: tool({
                    description: "Updates the lead's stage, budget, timeline, or notes in the CRM.",
                    inputSchema: z.object({
                        stage: z.string().optional().describe("e.g. QUALIFIED, ENGAGED, DISCOVERY, NURTURE, STOPPED"),
                        budget: z.string().optional(),
                        timeline: z.string().optional(),
                        notes: z.string().optional(),
                        reason: z.string().optional()
                    }),
                    execute: async (params) => {
                        return await AgentTools.updateLeadProfile({ leadId, ...params });
                    }
                })
            }
        });

        // 6. Record Final Agent Reasoning
        const thought = result.text?.slice(0, 500) || 'Action executed by autonomous agent.';
        await supabaseAdmin
            .from('leads')
            .update({
                last_agent_thought: thought,
                processing_lock_until: null // Release lock
            })
            .eq('id', leadId);

        console.log(`[ORCHESTRATOR] Completed evaluation for lead ${leadId}: ${thought.slice(0, 100)}...`);
        return { success: true, actionTaken: thought };

    } catch (err: any) {
        console.error(`[ORCHESTRATOR ERROR] Error processing lead ${leadId}:`, err);
        // Ensure lock is cleared on error
        await supabaseAdmin
            .from('leads')
            .update({ processing_lock_until: null })
            .eq('id', leadId);
        return { success: false, error: err.message };
    }
}
