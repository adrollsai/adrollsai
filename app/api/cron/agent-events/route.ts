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
    // Autonomous lead evaluation agent cron is strictly disabled to prevent runaway AI tokens.
    // AI is exclusively reserved for telephony voice calls and post-call transcript summarization.
    return NextResponse.json({
        success: true,
        message: 'Autonomous lead evaluation agent cron is disabled.',
        eventsProcessed: 0,
        watchdogLeadsEvaluated: 0
    });
}
