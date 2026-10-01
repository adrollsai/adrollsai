import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function createSchedulerTools(supabase: SupabaseClient, userId: string) {
  return {
    schedule_agent_task: tool({
      description: 'Schedules an automated agent task or cron job to run at a specific time in the future (e.g. launch campaign at 10 AM, send follow-up tomorrow, delete an asset).',
      inputSchema: z.object({
        taskTitle: z.string().describe('Short name or summary of the task to run'),
        eventType: z.enum([
          'SCHEDULED_CAMPAIGN',
          'FOLLOWUP_CHECK',
          'WHATSAPP_BROADCAST',
          'VOICE_CAMPAIGN',
          'DATA_CLEANUP',
          'CUSTOM_CRON'
        ]).describe('Category of the scheduled job'),
        scheduledFor: z.string().describe('ISO-8601 string or future timestamp (e.g. 2026-10-02T10:00:00Z) when the task should trigger'),
        payload: z.record(z.any()).describe('Contextual parameters for execution (e.g. leadIds, campaignName, message, targetTime)'),
        recurrence: z.string().optional().describe('Optional cron recurrence expression or label (e.g. "daily", "weekly", "0 9 * * *")'),
      }),
      execute: async ({ taskTitle, eventType, scheduledFor, payload, recurrence }) => {
        try {
          const { data, error } = await supabase
            .from('agent_events')
            .insert({
              user_id: userId,
              event_type: eventType,
              status: 'pending',
              scheduled_for: scheduledFor,
              payload: {
                ...payload,
                taskTitle,
                recurrence: recurrence || null,
                createdAt: new Date().toISOString(),
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select('*')
            .single();

          if (error) throw error;

          return {
            success: true,
            message: `Task '${taskTitle}' successfully scheduled for ${new Date(scheduledFor).toLocaleString()}.`,
            task: {
              id: data.id,
              eventType: data.event_type,
              scheduledFor: data.scheduled_for,
              status: data.status,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    list_scheduled_tasks: tool({
      description: 'Lists all scheduled agent tasks and crons for this user (both pending and recently processed).',
      inputSchema: z.object({
        status: z.enum(['pending', 'completed', 'failed', 'all']).default('pending').describe('Filter tasks by status'),
        limit: z.number().default(10).describe('Max number of tasks to return'),
      }),
      execute: async ({ status, limit }) => {
        try {
          let query = supabase
            .from('agent_events')
            .select('id, event_type, status, scheduled_for, payload, created_at')
            .eq('user_id', userId)
            .order('scheduled_for', { ascending: true })
            .limit(limit);

          if (status !== 'all') {
            query = query.eq('status', status);
          }

          const { data, error } = await query;
          if (error) throw error;

          return {
            success: true,
            total: data?.length || 0,
            tasks: (data || []).map((t: any) => ({
              id: t.id,
              eventType: t.event_type,
              title: t.payload?.taskTitle || t.event_type,
              scheduledFor: t.scheduled_for,
              status: t.status,
              recurrence: t.payload?.recurrence || null,
              created: t.created_at,
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    cancel_or_delete_scheduled_task: tool({
      description: 'Cancels or deletes a scheduled task or cron job before it executes.',
      inputSchema: z.object({
        taskId: z.string().describe('The UUID of the scheduled agent event to cancel or delete'),
        action: z.enum(['cancel', 'delete']).default('cancel').describe('Cancel (mark as cancelled) or permanently delete'),
      }),
      execute: async ({ taskId, action }) => {
        try {
          if (action === 'delete') {
            const { error } = await supabase
              .from('agent_events')
              .delete()
              .eq('id', taskId)
              .eq('user_id', userId);

            if (error) throw error;
            return { success: true, message: `Scheduled task ${taskId} permanently deleted.` };
          } else {
            const { data, error } = await supabase
              .from('agent_events')
              .update({
                status: 'cancelled',
                updated_at: new Date().toISOString(),
              })
              .eq('id', taskId)
              .eq('user_id', userId)
              .select('id, status')
              .single();

            if (error) throw error;
            return { success: true, message: `Scheduled task ${taskId} marked as cancelled.`, task: data };
          }
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
