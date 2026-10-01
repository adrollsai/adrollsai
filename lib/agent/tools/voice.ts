import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function createVoiceTools(supabase: SupabaseClient, userId: string) {
  return {
    get_call_history: tool({
      description: 'Fetches recent outbound AI phone call history, transcripts, and status (completed, busy, no-answer).',
      inputSchema: z.object({
        limit: z.number().default(10).describe('Number of recent calls to retrieve'),
        status: z.string().optional().describe('Filter by status (e.g. completed, busy, no-answer)'),
      }),
      execute: async ({ limit, status }) => {
        try {
          let q = supabase
            .from('call_logs')
            .select('id, lead_id, phone_number, duration, status, recording_url, summary, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

          if (status) {
            q = q.eq('status', status);
          }

          const { data, error } = await q;
          if (error) throw error;

          return {
            success: true,
            count: data?.length || 0,
            calls: (data || []).map((c: any) => ({
              id: c.id,
              phone: c.phone_number,
              duration: `${c.duration || 0}s`,
              status: c.status,
              summary: c.summary || 'No summary available',
              hasRecording: !!c.recording_url,
              time: c.created_at,
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    prepare_voice_campaign: tool({
      description: 'Prepares an automated AI voice calling campaign to follow up with leads (e.g., qualifying or booking appointments). Flags for Human-in-the-Loop user approval.',
      inputSchema: z.object({
        leadIds: z.array(z.string()).describe('List of lead UUIDs to call'),
        objective: z.string().default('book_appointment').describe('Call objective: book_appointment, qualify, re_engage, site_visit'),
        concurrency: z.number().default(2).describe('Number of simultaneous calls (1-5)'),
        customGreeting: z.string().optional().describe('Personalized greeting or property mention'),
      }),
      execute: async ({ leadIds, objective, concurrency, customGreeting }) => {
        try {
          const totalCalls = leadIds.length;
          const estimatedCostInr = (totalCalls * 2.5).toFixed(2); // Avg telephony cost

          return {
            success: true,
            requiresApproval: true,
            totalCalls,
            concurrency,
            estimatedCost: `₹${estimatedCostInr} INR`,
            actionPayload: {
              actionType: 'bulk_call',
              title: `Launch Voice Followup Campaign (${totalCalls} leads)`,
              description: `Autonomous AI calling campaign with objective "${objective}". Concurrency: ${concurrency} parallel calls.`,
              estimatedCost: `₹${estimatedCostInr}`,
              payload: {
                leadIds,
                objective,
                concurrency,
                customGreeting,
              },
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
