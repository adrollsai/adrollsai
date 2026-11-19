import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { bulkActionRefusal } from '../preflight';

/**
 * Two tools were removed from this file and must not come back:
 *
 *   create_whatsapp_template   rendered an HTML mock-up and answered `status: 'PENDING_APPROVAL'`
 *                              without contacting Meta. An owner was told a template existed when
 *                              nothing had been submitted.
 *   send_single_whatsapp_message
 *                              returned `status: 'sent'` with a timestamp and messaged nobody — no
 *                              Graph call, no test-mode guard, no logging. The single worst thing an
 *                              outreach tool can do is claim a customer was contacted.
 *
 * The real implementations live in lib/whatsapp/templates.ts (real Meta POST, real status) and
 * lib/agent/tools/outbound.ts (real send, through the test-mode choke point), and the agent reaches
 * them as `whatsapp_create_template` / `nobogent_whatsapp_send_template`.
 *
 * These two are left: `preview_whatsapp_message` renders a card and claims nothing, and
 * `prepare_whatsapp_broadcast` runs the real pre-flight guard and a real lead count before staging
 * an approval payload — which is exactly what the pre-flight gate tests against.
 */
export function createWhatsAppTools(supabase: SupabaseClient, userId: string) {
  return {

    preview_whatsapp_message: tool({
      description: 'Generates a visual WhatsApp message preview card (with optional image header, body text, and quick-reply action buttons). Renders directly in the chat.',
      inputSchema: z.object({
        headerImageUrl: z.string().optional().describe('URL for the image header if any'),
        bodyText: z.string().describe('The message copy to preview'),
        buttons: z.array(z.string()).default(['Book Site Visit', 'Call Agent']).describe('CTA buttons'),
        recipientName: z.string().default('Lead Name').describe('Sample recipient name for variable preview'),
      }),
      execute: async ({ headerImageUrl, bodyText, buttons, recipientName }) => {
        const formattedBody = bodyText.replace(/{{1}}|\{\{name\}\}/gi, recipientName);

        const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 340px; margin: 0 auto; background: #efeae2; padding: 16px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
  <div style="background: #ffffff; border-radius: 12px; padding: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); border-top-left-radius: 2px;">
    ${headerImageUrl ? `<img src="${headerImageUrl}" style="width: 100%; height: 160px; object-fit: cover; border-radius: 8px; margin-bottom: 8px;" />` : ''}
    <div style="font-size: 14px; line-height: 1.45; color: #111b21; white-space: pre-wrap;">${formattedBody}</div>
    <div style="text-align: right; font-size: 11px; color: #667781; margin-top: 4px;">12:00 PM <span style="color: #53bdeb;">✓✓</span></div>
  </div>
  <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
    ${buttons.map(btn => `
      <div style="background: #ffffff; border-radius: 8px; padding: 10px; text-align: center; color: #00a884; font-size: 13px; font-weight: 600; box-shadow: 0 1px 1px rgba(0,0,0,0.1); cursor: pointer;">
        ${btn}
      </div>
    `).join('')}
  </div>
</div>
        `.trim();

        return {
          success: true,
          previewHtml: html,
          formattedBody,
          artifact: {
            type: 'html_sandbox',
            title: 'WhatsApp Message Preview',
            html,
            description: 'Interactive visual preview of WhatsApp broadcast message',
          },
        };
      },
    }),

    prepare_whatsapp_broadcast: tool({
      description: 'Prepares a WhatsApp broadcast campaign for multiple leads. Flags the operation for Human-in-the-Loop user approval with exact cost estimate. PRE-FLIGHT GUARDED: without a segment, a message intent and an explicit send time it prepares NOTHING and returns status "missing_inputs" with the questions to ask through request_user_input first.',
      inputSchema: z.object({
        leadIds: z.array(z.string()).describe('List of lead UUIDs to receive the message'),
        messageText: z.string().describe('The template or freeform message text'),
        mediaUrl: z.string().optional().describe('Optional image or video URL'),
        campaignName: z.string().default('Agent Broadcast').describe('Campaign name'),
        when: z.string().optional().describe('When this should go out — "now", a date/time, or a schedule. Ask the owner; never assume.'),
      }),
      execute: async ({ leadIds, messageText, mediaUrl, campaignName, when }) => {
        // PRE-FLIGHT GUARD: a broadcast cannot be recalled, so a missing segment,
        // message intent or timing is refused before anything is prepared.
        const refusal = await bulkActionRefusal(
          {
            channel: 'whatsapp',
            recipients: Array.isArray(leadIds) ? leadIds.length : 0,
            segment: leadIds,
            messageIntent: messageText,
            when,
          },
          {
            tool: 'prepare_whatsapp_broadcast',
            action: `prepare a WhatsApp broadcast to ${Array.isArray(leadIds) ? leadIds.length : 0} leads`,
            supabase,
            userId,
          }
        );
        if (refusal) return refusal;

        try {
          const { count, error } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .in('id', leadIds)
            .eq('user_id', userId);

          if (error) throw error;

          const totalRecipients = count || leadIds.length;
          const estimatedCostInr = (totalRecipients * 0.85).toFixed(2); // Meta average conversation rate

          return {
            success: true,
            requiresApproval: true,
            totalRecipients,
            estimatedCost: `₹${estimatedCostInr} INR`,
            actionPayload: {
              actionType: 'whatsapp_broadcast',
              title: `Send WhatsApp Broadcast: "${campaignName}"`,
              description: `Ready to send personalized message to ${totalRecipients} selected leads.`,
              estimatedCost: `₹${estimatedCostInr}`,
              payload: {
                leadIds,
                messageText,
                mediaUrl,
                campaignName,
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
