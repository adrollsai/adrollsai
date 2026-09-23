import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

export interface FeedbackIssueInput {
    userId: string;
    source: 'USER_CORRECTION' | 'USER_FEEDBACK' | 'AGENT_SELF_DETECTED' | 'SYSTEM_DISCREPANCY';
    category: 'CAMPAIGN_CREATION' | 'VOICE_CALLING' | 'WHATSAPP_MESSAGING' | 'UNDERSTANDING_ERROR' | 'TOOL_FAILURE' | 'GENERAL';
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    userPrompt?: string;
    agentAction?: string;
    discrepancy: string;
    userCorrection?: string;
    suggestedFix?: string;
    metadata?: Record<string, any>;
}

/**
 * Records a discrepancy, user correction, or feedback into the Nobogent Engineering Feedback Engine.
 */
export async function recordFeedbackOrIssue(input: FeedbackIssueInput): Promise<{ success: boolean; ticketNumber: string; error?: string }> {
    const {
        userId,
        source,
        category,
        severity = 'MEDIUM',
        userPrompt,
        agentAction,
        discrepancy,
        userCorrection,
        suggestedFix,
        metadata = {}
    } = input;

    const ticketNumber = `ISS-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;

    const payload = {
        ticketNumber,
        source,
        category,
        severity,
        userPrompt,
        agentAction,
        discrepancy,
        userCorrection,
        suggestedFix,
        status: 'OPEN',
        metadata,
        recordedAt: new Date().toISOString()
    };

    try {
        // 1. Try to record in agent_feedback_issues table if available
        const { error: dbErr } = await supabaseAdmin
            .from('agent_feedback_issues')
            .insert({
                user_id: userId,
                ticket_number: ticketNumber,
                source,
                category,
                severity,
                user_prompt: userPrompt,
                agent_action: agentAction,
                discrepancy,
                user_correction: userCorrection,
                suggested_fix: suggestedFix,
                status: 'OPEN',
                metadata
            });

        // 2. If table doesn't exist, store reliably in agent_events with event_type = 'AGENT_FEEDBACK_ISSUE'
        if (dbErr) {
            await supabaseAdmin
                .from('agent_events')
                .insert({
                    user_id: userId,
                    event_type: 'AGENT_FEEDBACK_ISSUE',
                    scheduled_for: new Date().toISOString(),
                    payload,
                    status: 'completed'
                });
        }

        console.log(`[FEEDBACK ENGINE] Issue recorded successfully: ${ticketNumber} (${category})`);
        return { success: true, ticketNumber };
    } catch (err: any) {
        console.error('[FEEDBACK ENGINE] Failed to log issue:', err);
        return { success: false, ticketNumber, error: err.message };
    }
}

/**
 * Retrieves past feedback and corrections for a user so the agent avoids repeating mistakes.
 */
export async function getRecentLearnings(userId: string, limit = 5): Promise<string[]> {
    try {
        // Query recent feedback events
        const { data: events } = await supabaseAdmin
            .from('agent_events')
            .select('payload')
            .eq('user_id', userId)
            .eq('event_type', 'AGENT_FEEDBACK_ISSUE')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (!events || events.length === 0) return [];

        return events.map((e: any) => {
            const p = e.payload || {};
            return `• Discrepancy: ${p.discrepancy} | Correction: ${p.userCorrection || p.suggestedFix || 'None'}`;
        });
    } catch (e) {
        return [];
    }
}
