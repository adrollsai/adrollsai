import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The app's own creative knowledge, exposed to the agent.
 *
 * The dashboard's creative flow has two things the agent did not: a library of reference creatives it can
 * restyle from, and a vertical visual grammar (`buildImageSystemPrompt`) that encodes what a poster should
 * look like for a real-estate, food, fashion or clinic business.
 *
 * Without them the agent could still do image-to-image — `generate_ai_image` takes `referenceImageUrls` —
 * but only from a URL the user pasted, and it wrote prompts blind to the vertical rules. So the same request
 * produced a better image through the UI than through the agent. These two tools close that gap.
 *
 * WHAT THIS TOOL NO LONGER KNOWS ABOUT: the app's 35 built-in luxury real-estate designs. They are the super
 * admin's demo shelf, no other account may be built from them, and `list_reference_creatives` no longer
 * returns them at all — not with a flag, not on a fallback.
 */
export function createReferenceCreativeTools(supabase: SupabaseClient, userId: string) {
  return {
    list_reference_creatives: tool({
      description:
        'List the reference creatives this business uploaded itself — its real brand style. There is no built-in ' +
        'example catalogue to fall back on: if the account has none, this says so and you build from the brand kit and ' +
        'the brief. Treat any reference as a DESIGN reference, not content — keep the layout, typography, framing and ' +
        'surface treatment, and replace the place, the brand marks and any claims with the client\'s own. Never present ' +
        'a reference image as if it were the client\'s actual property.',
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe('Optional substring filter on the category, e.g. "waterfront", "direct response", "minimalist"'),
        library: z
          .enum(['all', 'high_converting', 'premium'])
          .default('all')
          .describe('high_converting = urgency and offer-led; premium = editorial and luxury'),
        limit: z.number().int().min(1).max(35).default(12).describe('How many to return'),
      }),
      execute: async ({ category, limit }) => {
        const cat = (category || '').toLowerCase();

        /**
         * THE TENANT'S OWN REFERENCES ARE THE ONLY REFERENCES.
         *
         * Measured for one account: 35 built-in references beside its own 19 uploads, and this tool only ever read the
         * built-ins — so a film academy asking for "a creative like this one" was shown estate-agent designs while its
         * own, on-brand uploads were invisible. The catalogue is now unreachable from here entirely: own references, or
         * an honest "none".
         */
        try {
          const { data: own } = await supabase
            .from('reference_creatives')
            .select('id, name, category, url, description')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(60);

          const ownMatches = ((own || []) as any[]).filter(
            (row) =>
              !cat ||
              String(row.category || '').toLowerCase().includes(cat) ||
              String(row.name || '').toLowerCase().includes(cat)
          );

          if (ownMatches.length) {
            return {
              success: true,
              source: 'account',
              count: Math.min(ownMatches.length, limit),
              message:
                `${ownMatches.length} reference creative(s) from THIS account's own reference library. These are the ` +
                'client\'s real brand style — imitate them.',
              creatives: ownMatches.slice(0, limit).map((row) => ({
                id: row.id,
                name: row.name,
                category: row.category || 'own',
                url: row.url,
                isOwn: true,
              })),
            };
          }
          /**
           * NO BUILT-IN SHELF, FOR ANY ACCOUNT.
           *
           * This used to fall back to the app's 35 built-in luxury real-estate designs (and, before that, only ever
           * read them). The operator's rule: "never use the super admin designs for real estate for any account, use
           * the users' own ref if uploaded, it's own brand kit if provided otherwise the ai can create a prompt on
           * it's own based on the data it has access to."
           *
           * So the catalogue is not reachable from here at all — not with a flag, not on a fallback. With no
           * references of its own, the account is told to build from its brand kit and its own data, and that a
           * person can upload references in the Reference Library.
           */
          return {
            success: true,
            source: 'none',
            count: 0,
            message:
              'This account has no reference creatives of its own. Do NOT substitute built-in examples or any other ' +
              'business\u2019s designs — none are available, by rule. Build the creative from the brand kit and the brief, ' +
              'and tell the owner they can upload references in the Reference Library.',
          };
        } catch {
          // A failed read is a "no references" answer, not a crash — and still never a borrowed design.
          return {
            success: true,
            source: 'none',
            count: 0,
            message:
              'Could not read this account\u2019s reference library. Do not substitute built-in examples. Build the ' +
              'creative from the brand kit and the brief.',
          };
        }
      },
    }),

    get_creative_rules: tool({
      description:
        'Get the house visual rules for this business\'s vertical before writing an image prompt — composition, ' +
        'typography, lighting, what to avoid. The dashboard creative flow applies these automatically; the agent ' +
        'must fetch them explicitly. Call this for branded graphics, ad creatives, posters and offer cards, then ' +
        'fold the rules into the prompt you pass to generate_ai_image.',
      inputSchema: z.object({
        isOrganic: z
          .boolean()
          .default(false)
          .describe('true for organic social posts (less hard-sell, more natural), false for paid ad creatives'),
      }),
      execute: async ({ isOrganic }) => {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('business_name, industry, brand_color, logo_url, contact_number, business_info')
            .eq('id', userId)
            .maybeSingle();

          let industry = profile?.industry || null;
          if (!industry && profile?.business_info) {
            const info: any = profile.business_info;
            industry = info?.industry || null;
          }

          const { buildImageSystemPrompt, SUPPORTED_INDUSTRIES } = await import('@/utils/image-prompt-master');
          const resolved = industry || 'general';
          const rules = buildImageSystemPrompt(resolved, isOrganic);

          return {
            success: true,
            industry: resolved,
            detected: Boolean(industry),
            supportedIndustries: SUPPORTED_INDUSTRIES,
            brand: {
              business: profile?.business_name || null,
              brandColor: profile?.brand_color || null,
              logoUrl: profile?.logo_url || null,
              contact: profile?.contact_number || null,
            },
            rules,
            message: industry
              ? `House visual rules for the ${resolved} vertical.`
              : `No industry on this profile, so these are the general rules. Ask the user what kind of business it is if it matters, or set it in Settings.`,
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not load the visual rules.' };
        }
      },
    }),
  };
}