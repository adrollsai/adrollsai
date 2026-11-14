import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { bulkActionRefusal } from '../preflight';

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

    update_default_voice_settings: tool({
      description: 'Updates the user account DEFAULT 24/7 background calling agent settings (used for auto-calling new inbound leads and ongoing unconnected follow-ups). Changes default voice character, default language, prompt script, or auto-call toggle without launching a bulk campaign.',
      inputSchema: z.object({
        voiceName: z.string().optional().describe('Voice model name/character (e.g., "Aoede", "Puck", "Kore", "Fenrir", "Charon", "Aditi")'),
        defaultCallingLanguage: z.enum(['hinglish', 'english', 'hindi']).optional().describe('Primary language for incoming/new lead calls'),
        autoCallNewLeads: z.boolean().optional().describe('Whether to automatically place an AI qualification call immediately when a new lead enters the CRM'),
        systemPromptScript: z.string().optional().describe('The core conversation script and qualification guidelines for the default bot'),
      }),
      execute: async ({ voiceName, defaultCallingLanguage, autoCallNewLeads, systemPromptScript }) => {
        try {
          const updatePayload: Record<string, any> = {};
          if (voiceName !== undefined) updatePayload.voice_name = voiceName;
          if (defaultCallingLanguage !== undefined) updatePayload.default_calling_language = defaultCallingLanguage;
          if (autoCallNewLeads !== undefined) updatePayload.auto_call_new_leads = autoCallNewLeads;
          if (systemPromptScript !== undefined) updatePayload.custom_prompt = systemPromptScript;

          const { error } = await supabase
            .from('profiles')
            .update(updatePayload)
            .eq('id', userId);

          if (error) throw error;

          return {
            success: true,
            message: 'Default background calling agent settings updated successfully.',
            updatedSettings: updatePayload,
          };
        } catch (err: any) {
          return { success: false, error: err.message || 'Failed to update default voice settings' };
        }
      },
    }),

    launch_bulk_calling_campaign: tool({
      description: 'Launches or prepares a separate, on-demand bulk outbound AI calling campaign to a filtered list of leads using a custom one-time campaign script and voice. Kept completely separate from the default ongoing follow-up bot. PRE-FLIGHT GUARDED: without a segment, a script intent and an explicit calling window it launches NOTHING and returns status "missing_inputs" with the questions to ask through request_user_input first.',
      inputSchema: z.object({
        leadIds: z.array(z.string()).describe('Target lead UUIDs to call in this blast'),
        campaignName: z.string().describe('Campaign name (e.g., "Festive Offer Blast", "Weekend Site Visit Push")'),
        customCampaignScript: z.string().describe('The dedicated one-time pitch/script for this bulk campaign'),
        voiceName: z.string().default('Aoede').describe('Voice character for this campaign'),
        concurrency: z.number().default(3).describe('Number of simultaneous calls (1-5)'),
        when: z.string().optional().describe('When the calls should start — "now", a date/time, or a daily window. Ask the owner; never assume.'),
      }),
      execute: async ({ leadIds, campaignName, customCampaignScript, voiceName, concurrency, when }) => {
        // PRE-FLIGHT GUARD: a call blast rings real phones, so a missing segment,
        // script intent or calling window is refused before anything is queued.
        const refusal = await bulkActionRefusal(
          {
            channel: 'call',
            recipients: Array.isArray(leadIds) ? leadIds.length : 0,
            segment: leadIds,
            messageIntent: customCampaignScript,
            when,
          },
          {
            tool: 'launch_bulk_calling_campaign',
            action: `launch a calling campaign to ${Array.isArray(leadIds) ? leadIds.length : 0} leads`,
            supabase,
            userId,
          }
        );
        if (refusal) return refusal;

        try {
          const totalCalls = leadIds.length;
          const estimatedCostInr = (totalCalls * 2.5).toFixed(2); // Avg telephony cost

          return {
            success: true,
            requiresApproval: true,
            campaignName,
            totalCalls,
            concurrency,
            estimatedCost: `₹${estimatedCostInr} INR`,
            actionPayload: {
              actionType: 'bulk_call',
              title: `Launch Calling Campaign: "${campaignName}"`,
              description: `On-demand blast to ${totalCalls} leads with custom script using voice "${voiceName}". Concurrency: ${concurrency} simultaneous lines.`,
              estimatedCost: `₹${estimatedCostInr}`,
              payload: {
                leadIds,
                campaignName,
                customCampaignScript,
                voiceName,
                concurrency,
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
