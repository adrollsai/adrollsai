import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bankStatus,
  findReference,
  referenceBrief,
  referenceMenu,
  type ReferenceKind,
} from '@/lib/agent/creative/reference-bank';
import { decideMediaPlan, fetchTenantAssets, mediaRulesBlock } from '@/lib/agent/creative/media-strategy';

/**
 * The reference bank, as two tools.
 *
 * `list_reference_bank` is the shelf: every entry with a short summary and its measured shape, so
 * the agent can pick without watching or opening anything twice. `use_reference` is the handover:
 * it returns how that specific reference is built, where to look at it, what media of the client's
 * own will be used and in what order — and the rules that cannot be broken while rebuilding it.
 *
 * The bank is deliberately small and curated. It is also the standard: after building, the agent is
 * told to compare its result against this reference and fix what does not match, rather than to
 * decide for itself whether the output is good.
 */
export function createReferenceBankTools(supabase: SupabaseClient, userId: string) {
  return {
    list_reference_bank: tool({
      description:
        'List the curated reference bank: finished videos and creatives we have measured, each with a short ' +
        'summary, its aspect, its length and how it is built. Use this FIRST whenever the person says "like this", ' +
        '"in that style", references a competitor, or simply wants something that does not look generic. ' +
        'Pick the entry closest to the request and pass its id to use_reference. If the bank has nothing close, ' +
        'say so and fall back to list_reference_creatives or find_reference_creatives rather than inventing a style.',
      inputSchema: z.object({
        kind: z.enum(['video', 'image', 'page']).describe('Which shelf to look at'),
        industry: z
          .string()
          .optional()
          .describe('The client\'s vertical, e.g. "real estate" — entries matching it are ranked first'),
      }),
      execute: async ({ kind, industry }) => {
        const status = bankStatus();
        const menu = referenceMenu(kind as ReferenceKind, industry);
        return {
          success: true,
          bank: status,
          menu,
          rules: mediaRulesBlock(),
          next:
            status.videos + status.images + status.pages === 0
              ? 'The bank is empty — use list_reference_creatives or find_reference_creatives instead.'
              : 'Choose the entry closest to this brief, then call use_reference with its id.',
        };
      },
    }),

    use_reference: tool({
      description:
        'Take one banked reference and get everything needed to rebuild it for this business: how it is built, ' +
        'where to watch or look at it, how to compare the result against it, and which of the client\'s own media ' +
        'to use (product-linked assets first, stills animated rather than replaced, generated media only as a last ' +
        'resort). Follow the returned rules exactly — including that product information may never be invented and ' +
        'generated footage may never exceed 30 seconds. When you are done, compare your render against the ' +
        'reference before delivering.',
      inputSchema: z.object({
        kind: z.enum(['video', 'image', 'page']).describe('Which shelf the reference came from'),
        id: z.string().describe('The reference id returned by list_reference_bank'),
        productId: z
          .string()
          .optional()
          .describe('The catalogue product being advertised, so assets already linked to it are preferred'),
      }),
      execute: async ({ kind, id, productId }) => {
        const reference = findReference(kind as ReferenceKind, id);
        if (!reference) {
          return {
            success: false,
            message: `No ${kind} reference with id "${id}".`,
            menu: referenceMenu(kind as ReferenceKind),
          };
        }
        const assets = await fetchTenantAssets(supabase, userId);
        const mediaPlan = decideMediaPlan({
          assets,
          propertyId: productId ?? null,
          hasReferenceImage: kind === 'image',
        });
        return {
          success: true,
          referenceId: reference.id,
          brief: referenceBrief(reference),
          mediaPlan,
          rules: mediaRulesBlock(),
          deliverWith: 'the client\'s own media where it exists, the reference\'s structure everywhere else',
          beforeDelivering: 'compare your result against the reference; fix what does not match, then deliver',
        };
      },
    }),
  };
}
