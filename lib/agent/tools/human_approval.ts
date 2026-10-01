import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { sendPushNotification } from '@/utils/notification-helper';
import * as crypto from 'crypto';

export function createHumanApprovalTool(supabase: SupabaseClient, userId: string) {
  return {
    request_human_approval: tool({
      description: 'Pauses execution and requests human user approval before performing high-impact or billable operations (e.g. sending bulk WhatsApp campaigns, making multiple automated phone calls, deleting database records, spending ad budget). Dispatches push notification and renders approval card in chat.',
      inputSchema: z.object({
        actionType: z.enum(['whatsapp_broadcast', 'bulk_call', 'delete_data', 'ad_spend', 'custom']).describe('Category of sensitive operation'),
        title: z.string().describe('Clear title of the pending action (e.g. Approve WhatsApp Broadcast to 35 Leads)'),
        description: z.string().describe('Detailed explanation of what will happen upon approval'),
        estimatedCost: z.string().optional().describe('Estimated monetary or credit cost (e.g. ₹35.00 INR)'),
        actionPayload: z.record(z.string(), z.any()).describe('The parameters required to execute the action once approved'),
      }),
      execute: async ({ actionType, title, description, estimatedCost, actionPayload }) => {
        try {
          const actionId = 'act_' + crypto.randomBytes(8).toString('hex');

          // Persist to agent_events table
          const { error: insertError } = await supabase
            .from('agent_events')
            .insert({
              id: crypto.randomUUID(),
              user_id: userId,
              event_type: 'PENDING_ACTION_APPROVAL',
              status: 'pending',
              payload: {
                actionId,
                actionType,
                title,
                description,
                estimatedCost,
                actionPayload,
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

          if (insertError) {
            console.warn('[HITL] Failed to record in agent_events:', insertError.message);
          }

          // Trigger Web Push / FCM Push Notification
          try {
            await sendPushNotification(
              userId,
              `⚠️ Approval Required: ${title}`,
              description.slice(0, 100),
              `/dashboard/agent?actionId=${actionId}`
            );
          } catch (pushErr: any) {
            console.warn('[HITL] Push dispatch error:', pushErr.message);
          }

          return {
            success: true,
            status: 'pending_user_confirmation',
            actionId,
            artifact: {
              type: 'action_confirmation',
              actionId,
              title,
              description,
              estimatedCost,
              actionType,
              payload: actionPayload,
              status: 'pending',
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
