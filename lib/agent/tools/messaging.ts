import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createWhatsAppTemplate, listWhatsAppTemplates } from '@/lib/whatsapp/templates';

/**
 * Creating a WhatsApp template from chat.
 *
 * The agent's old `create_whatsapp_template` never contacted Meta: it rendered an HTML mock-up and
 * answered `status: 'PENDING_APPROVAL'`, so an owner was told a template existed when nothing had been
 * submitted. The real implementation lived in an HTTP route the agent could not reach.
 *
 * This one submits to Meta and reports Meta's own verdict — normally PENDING, because approval is
 * Meta's decision and takes minutes to a day. It never claims a template is usable until Meta says
 * APPROVED; `whatsapp_template_status` is the honest re-check before a campaign.
 *
 * Creating a template messages nobody and costs nothing, so it is not behind the approval gate. It is
 * also not irreversible (templates can be deleted in Meta's manager), which is the test the gate uses.
 */

export function createMessagingTools(supabase: SupabaseClient, userId: string) {
  return {
    whatsapp_create_template: tool({
      description:
        'Submit a new WhatsApp message template to Meta for approval. Give it a lowercase name, a category, ' +
        'the body copy (use {{1}}, {{2}} for variables), optionally a TEXT header, a footer and up to three ' +
        'buttons. It returns Meta\'s template id and status — usually PENDING, because Meta reviews templates; ' +
        'only APPROVED templates can be broadcast. Creating one messages nobody and spends nothing.',
      inputSchema: z.object({
        name: z.string().describe('Template name, lowercase with underscores, e.g. diwali_offer_v1'),
        category: z.enum(['MARKETING', 'UTILITY']).optional().describe('MARKETING for offers, UTILITY for account/service updates'),
        bodyText: z.string().describe('The message body. Use {{1}} style variables where the values differ per send.'),
        headerText: z.string().optional().describe('Optional TEXT header (max 60 characters)'),
        footerText: z.string().optional().describe('Optional footer line'),
        language: z.string().optional().describe('Language code, default en_US'),
        buttons: z
          .array(
            z.object({
              type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']).describe('Button kind'),
              text: z.string().describe('Button label (max 25 characters)'),
              value: z.string().optional().describe('The URL or phone number for the two call-to-action kinds'),
            })
          )
          .optional()
          .describe('Up to three buttons'),
      }),
      execute: async (input: any) => {
        const result = await createWhatsAppTemplate(supabase, userId, {
          name: String(input?.name ?? ''),
          category: input?.category === 'UTILITY' ? 'UTILITY' : 'MARKETING',
          bodyText: String(input?.bodyText ?? ''),
          ...(input?.headerText ? { headerType: 'TEXT' as const, headerText: String(input.headerText) } : {}),
          ...(input?.footerText ? { footerText: String(input.footerText) } : {}),
          ...(input?.language ? { language: String(input.language) } : {}),
          ...(Array.isArray(input?.buttons) ? { buttons: input.buttons } : {}),
        });

        if (!result.ok) {
          return {
            success: false,
            problems: result.problems,
            error: result.error,
            note: result.problems?.length
              ? 'Nothing was sent to Meta; fix the problems above and try again.'
              : 'Meta refused the template; the reason is Meta\'s own words.',
          };
        }

        return {
          success: true,
          name: result.name,
          templateId: result.templateId,
          status: result.status,
          category: result.category,
          language: result.language,
          message:
            `Submitted "${result.name}" to Meta. Its status is ${result.status}` +
            (result.status === 'APPROVED'
              ? ', so it can be sent now.'
              : ' — Meta reviews templates, usually within minutes to a day. Until it is APPROVED a campaign using it will be refused.'),
          next: 'Check it later with whatsapp_template_status before broadcasting.',
        };
      },
    }),

    whatsapp_template_status: tool({
      description:
        'List this account\'s real WhatsApp templates with their Meta status (APPROVED / PENDING / REJECTED) and ' +
        'language. Use it before a broadcast to confirm the template can actually be sent, and when the owner ' +
        'asks which templates exist or why a send failed.',
      inputSchema: z.object({
        name: z.string().optional().describe('Check one template by name'),
        onlyApproved: z.boolean().optional().describe('Return only APPROVED, sendable templates'),
      }),
      execute: async (input: any) => {
        try {
          const templates = await listWhatsAppTemplates(supabase, userId);
          const wanted = String(input?.name ?? '').trim();
          let rows = wanted ? templates.filter((t) => t.name === wanted) : templates;
          if (input?.onlyApproved) rows = rows.filter((t) => t.status === 'APPROVED');
          if (!rows.length) {
            return {
              success: true,
              count: 0,
              message: wanted
                ? `Meta has no template called "${wanted}" on this account.`
                : 'This account has no WhatsApp templates at Meta yet.',
            };
          }
          return {
            success: true,
            count: rows.length,
            approvedCount: rows.filter((t) => t.status === 'APPROVED').length,
            templates: rows.map((t) => ({
              name: t.name,
              status: t.status,
              language: t.language,
              category: t.category,
              rejectedReason: t.rejectedReason ?? undefined,
            })),
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),
  };
}
