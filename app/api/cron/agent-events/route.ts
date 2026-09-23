import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processLeadEvent } from '@/lib/agent/lead-orchestrator';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

/**
 * Scheduled Worker for Event-Driven Agent Wake-up & "No Lead Left Behind" Watchdog.
 * Can be called by Vercel Cron, Supabase pg_net / pg_cron, or external cron services.
 */
export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const secret = url.searchParams.get('secret') || req.headers.get('authorization')?.replace('Bearer ', '');
        const configuredSecret = process.env.CRON_SECRET;

        // Basic auth guard (optional for internal VPC / local testing)
        if (configuredSecret && secret !== configuredSecret) {
            console.warn('[AGENT CRON] Unauthorized cron attempt.');
        }

        const now = new Date().toISOString();
        let eventsProcessed = 0;
        let watchdogLeadsEvaluated = 0;

        // 1. Process Due Events in agent_events
        const { data: dueEvents } = await supabaseAdmin
            .from('agent_events')
            .select('*')
            .eq('status', 'pending')
            .lte('scheduled_for', now)
            .order('scheduled_for', { ascending: true })
            .limit(25);

        if (dueEvents && dueEvents.length > 0) {
            console.log(`[AGENT CRON] Found ${dueEvents.length} due scheduled events.`);
            for (const event of dueEvents) {
                try {
                    await supabaseAdmin
                        .from('agent_events')
                        .update({ status: 'processing', updated_at: now })
                        .eq('id', event.id);

                    const res = await processLeadEvent({
                        eventType: event.event_type as any || 'RE_EVALUATE',
                        leadId: event.lead_id,
                        metadata: event.payload
                    });

                    await supabaseAdmin
                        .from('agent_events')
                        .update({
                            status: res.success ? 'completed' : 'failed',
                            error_message: res.error || null,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', event.id);

                    if (res.success) eventsProcessed++;
                } catch (eventErr: any) {
                    console.error(`[AGENT CRON] Error executing event ${event.id}:`, eventErr);
                    await supabaseAdmin
                        .from('agent_events')
                        .update({
                            status: 'failed',
                            error_message: eventErr.message,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', event.id);
                }
            }
        }

        // 2. "No Lead Left Behind" Watchdog
        // Finds leads whose next_action_due_at has passed and evaluates them
        const { data: overdueLeads } = await supabaseAdmin
            .from('leads')
            .select('id, name, assigned_to, autonomous_status, next_action_due_at')
            .not('next_action_due_at', 'is', null)
            .lte('next_action_due_at', now)
            .not('autonomous_status', 'in', '("BOOKED","STOPPED","LOST","INVALID")')
            .order('next_action_due_at', { ascending: true })
            .limit(15);

        if (overdueLeads && overdueLeads.length > 0) {
            console.log(`[AGENT CRON] Watchdog picked up ${overdueLeads.length} overdue leads.`);
            for (const lead of overdueLeads) {
                try {
                    const res = await processLeadEvent({
                        eventType: 'WATCHDOG_CHECK',
                        leadId: lead.id
                    });
                    if (res.success) watchdogLeadsEvaluated++;
                } catch (leadErr: any) {
                    console.error(`[AGENT CRON] Watchdog error for lead ${lead.id}:`, leadErr);
                }
            }
        }

        return NextResponse.json({
            success: true,
            timestamp: now,
            eventsProcessed,
            watchdogLeadsEvaluated
        });

    } catch (err: any) {
        console.error('[AGENT CRON] Fatal error in agent-events worker:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
