import { createClient } from '@supabase/supabase-js';
import * as AgentTools from './tools';
import { fulfillPendingDeliveriesIfAny } from './whatsapp-policy';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

export interface FastTriageResult {
    handled: boolean;
    reason?: 'opt_out' | 'handshake_fulfilled' | 'faq_instant_answer';
    actionSummary?: string;
}

/**
 * Fast Heuristic & FAQ Pre-Router (0ms latency, 0 token cost).
 * Handles predictable customer intents (opt-outs, simple handshakes, standard greetings)
 * before invoking the reasoning LLM.
 */
export async function fastTriageInboundMessage(leadId: string, text: string): Promise<FastTriageResult> {
    if (!text) return { handled: false };
    const cleaned = text.trim().toLowerCase();

    // 1. Instant Opt-Out / DNC Detection
    const optOutPatterns = [
        /\bstop\b/i,
        /\bunsubscribe\b/i,
        /\bnot interested\b/i,
        /\bwrong number\b/i,
        /\bdon'?t call\b/i,
        /\bmat call\b/i,
        /\bcall mat\b/i,
        /\bremove my number\b/i,
        /\bblock me\b/i
    ];

    if (optOutPatterns.some(pattern => pattern.test(cleaned))) {
        console.log(`[FAST TRIAGE] Instant opt-out detected for lead ${leadId} ("${text}"). Bypassing LLM.`);
        await AgentTools.updateLeadProfile({
            leadId,
            stage: 'Lost',
            notes: `Lead requested opt-out / DNC via message: "${text}". Autonomous messaging halted.`
        });
        return {
            handled: true,
            reason: 'opt_out',
            actionSummary: 'Lead opted out. Marked as STOPPED without LLM invocation.'
        };
    }

    // 2. Handshake Unlock / Casual Ping ("Hi", "Hello", "Hey", "Send", "Bhejo")
    const casualPings = ['hi', 'hello', 'hey', 'hii', 'hiii', 'bhejo', 'send', 'send brochure', 'yes please', 'ok'];
    if (casualPings.includes(cleaned)) {
        const handshake = await fulfillPendingDeliveriesIfAny(leadId);
        if (handshake.fulfilled && handshake.count > 0) {
            console.log(`[FAST TRIAGE] Handshake fulfilled for lead ${leadId} (${handshake.count} deliveries sent). Bypassing LLM.`);
            return {
                handled: true,
                reason: 'handshake_fulfilled',
                actionSummary: `Delivered ${handshake.count} pending items via Call-to-WhatsApp Handshake.`
            };
        }
    }

    return { handled: false };
}
