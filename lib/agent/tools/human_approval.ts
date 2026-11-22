import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { sendPushNotification } from '@/utils/notification-helper';
import * as crypto from 'crypto';

export function createHumanApprovalTool(supabase: SupabaseClient, userId: string) {
  return {
    request_human_approval: tool({
      description:
        'Pauses execution and requests human user approval before high-impact or billable operations (e.g. sending bulk WhatsApp campaigns, making multiple automated phone calls, deleting database records, spending ad budget). Dispatches push notification and renders approval card in chat. ' +
        'IMPORTANT — do NOT use this to stage a billable image/video/voice generation. Those tools are wrapped by the review gate, which stages the approval card itself, already carrying the tool\'s exact arguments. Calling this tool instead produces a card holding your SUMMARY of the call, and approving it replays that summary into the tool and fails ("prompt is required"). To get a billable generation approved, just call it: if it needs review it returns needs_review with an actionId and the card is on screen. ' +
        'Use this tool for decisions that no gated tool can stage: a custom plan, a bulk operation you want confirmed before composing it, or anything irreversible that has no tool-level gate. Put the resolved choices in `spec` and anything already produced in `previews`, so the user approves a finished plan rather than a guess.',
      inputSchema: z.object({
        actionType: z.enum(['whatsapp_broadcast', 'bulk_call', 'delete_data', 'ad_spend', 'create_asset', 'custom']).describe('Category of sensitive operation'),
        title: z.string().describe('Clear title of the pending action (e.g. Approve WhatsApp Broadcast to 35 Leads)'),
        description: z.string().describe('Detailed explanation of what will happen upon approval'),
        estimatedCost: z.string().optional().describe('Estimated monetary or credit cost (e.g. ₹35.00 INR)'),
        spec: z
          .array(
            z.object({
              label: z.string().describe('What this row is, e.g. "Script", "Voice", "Dimensions", "Reference", "Duration"'),
              value: z.string().describe('The resolved value the user is approving'),
            })
          )
          .optional()
          .describe('Resolved parameters, shown as a spec sheet on the card. Use for any creative or billable job.'),
        previews: z
          .array(
            z.object({
              kind: z.enum(['audio', 'image', 'video']).describe('What kind of preview this is'),
              url: z.string().describe('Public URL of the preview asset'),
              caption: z.string().optional().describe('One line describing what the user is looking at'),
            })
          )
          .optional()
          .describe('Already-produced previews (voiceover audio, poster frame, chosen reference). Generating these costs little and makes the review concrete.'),
        resumePrompt: z
          .string()
          .optional()
          .describe('Instruction to continue with once approved, e.g. "Approved — generate the video now with the staged plan." The user\'s approval sends this back to you.'),
        actionPayload: z.record(z.string(), z.any()).describe('The parameters required to execute the action once approved'),
      }),
      execute: async ({ actionType, title, description, estimatedCost, spec, previews, resumePrompt, actionPayload }) => {
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
              // scheduled_for is NOT NULL on this table. Without it the insert was
              // rejected, the card still rendered from the tool result, and tapping
              // Approve then 404'd because no row existed to update.
              scheduled_for: new Date().toISOString(),
              payload: {
                actionId,
                actionType,
                title,
                description,
                estimatedCost,
                spec,
                previews,
                resumePrompt,
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

          // And on WhatsApp, because that is where the owner actually is. Kept
          // best-effort: a closed 24h window means the send fails, and the card plus
          // the push still stand. Never blocks the approval from being recorded.
          try {
            const { data: owner } = await supabase
              .from('profiles')
              .select('whatsapp_phone_number, contact_number')
              .eq('id', userId)
              .single();
            const to = owner?.whatsapp_phone_number || owner?.contact_number;
            if (to) {
              const specLines = (spec || [])
                .slice(0, 6)
                .map((s) => `${s.label}: ${String(s.value).replace(/\s+/g, ' ').slice(0, 120)}`)
                .join('\n');
              const body =
                `*${title}*\n\n` +
                (specLines ? `${specLines}\n\n` : '') +
                (estimatedCost ? `Cost: ${estimatedCost}\n\n` : '') +
                'Reply *APPROVE* or *SKIP*, or just describe the change you want ' +
                '(for example: "headline shorter, no price").';
              const { sendNobogentTextMessage } = await import('@/utils/creative-approval-handler');
              const ok = await sendNobogentTextMessage(to, body);
              console.log(`[HITL] WhatsApp approval sent to owner: ${ok ? 'yes' : 'no (window may be closed)'}`);
            }
          } catch (waErr: any) {
            console.warn('[HITL] WhatsApp approval dispatch error:', waErr?.message || waErr);
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
              spec,
              previews,
              resumePrompt,
              payload: actionPayload,
              status: 'pending',
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    request_user_input: tool({
      description: 'Requests essential input, preferences, or clarification from the user at any point in an autonomous flow. Immediately sends a push notification to their device so they can provide the answer even if they navigated away or closed the tab. Pass `questions` to ask a BATCH of questions in one walkthrough (the docked panel steps through them one at a time) instead of one round trip per question — this is the pre-flight call for any big action that is missing required inputs (a campaign budget, locations, which asset to run, the offer, the segment, the timing). Four questions maximum; mark the answer you would pick with `recommended: true`.',
      inputSchema: z.object({
        // OPTIONAL, and that is the fix. `questions` is the batch form this description recommends for a pre-flight
        // ("a campaign budget, locations, which asset to run, the offer, the segment, the timing"), but `question` was
        // REQUIRED - so a model that did exactly what it was told and passed only `questions` had the whole call
        // rejected by schema validation: "expected string, received undefined" at path `question`. Measured on a real
        // ads pre-flight: the agent composed four excellent questions, was refused twice, and fell back to prose.
        question: z
          .string()
          .optional()
          .describe('A single question. Omit when you pass `questions` (the batch form) instead.'),
        context: z.string().optional().describe('Why this input is required for the workflow'),
        suggestedOptions: z.array(z.string()).optional().describe('Optional list of quick choices/options'),
        questions: z
          .array(
            z.object({
              question: z.string().describe('One question'),
              context: z.string().optional().describe('Why this one matters'),
              options: z
                .array(
                  z.object({
                    label: z.string().describe('The short answer the user can pick'),
                    description: z.string().optional().describe('One line on what choosing this implies'),
                    recommended: z.boolean().optional().describe('Mark the option you would pick'),
                  })
                )
                .optional()
                .describe('Likely answers, best first. The user may still type their own.'),
            })
          )
          .optional()
          .describe('Ask several questions in one go. When present, `question` is ignored.'),
      }),
      execute: async ({ question, context, suggestedOptions, questions }: any) => {
        try {
          const inputRequestId = 'input_' + crypto.randomBytes(6).toString('hex');

          // One question is the common case; `questions` is the batch form. Keep a
          // flat `question` alongside so any older renderer still has something to
          // show.
          const batch = Array.isArray(questions)
            ? questions.filter((q: any) => String(q?.question ?? '').trim())
            : [];
          const list = batch.length
            ? batch
            : String(question ?? '').trim()
              ? [
                  {
                    question: String(question).trim(),
                    context,
                    options: (Array.isArray(suggestedOptions) ? suggestedOptions : []).map((label: string) => ({ label })),
                  },
                ]
              : null;

          if (!list) {
            return {
              success: false,
              error:
                'Ask at least one question: pass `question` for a single one, or `questions` (an array of ' +
                '{question, context?, options?[{label, description?, recommended?}]}) for a batch.',
            };
          }

          const headline = list[0].question;

          // Send push notification to user device
          try {
            await sendPushNotification(
              userId,
              '🔔 Nobogent Agent Needs Your Input',
              String(headline).slice(0, 120),
              `/dashboard/agent?inputRequestId=${inputRequestId}`
            );
          } catch (e: any) {
            console.warn('[UserInput] Push notification dispatch failed:', e.message);
          }

          return {
            success: true,
            status: 'awaiting_user_input',
            inputRequestId,
            question: headline,
            context,
            suggestedOptions: list ? (list[0] as any).options?.map((o: any) => o.label) : suggestedOptions,
            questions: list,
            artifact: {
              type: 'user_input_prompt',
              inputRequestId,
              question: headline,
              context,
              suggestedOptions: list ? (list[0] as any).options?.map((o: any) => o.label) : suggestedOptions,
              // The docked panel reads this; without it the user gets the old
              // inline card buried in the transcript.
              questions: list,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
