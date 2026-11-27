import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL_REFERENCE_TEMPLATES } from '@/utils/reference-templates-data';

/**
 * The app's own creative knowledge, exposed to the agent.
 *
 * The dashboard's creative flow has two things the agent did not: a library of 35
 * reference creatives it can restyle from, and a vertical visual grammar
 * (`buildImageSystemPrompt`) that encodes what a poster should look like for a
 * real-estate, food, fashion or clinic business.
 *
 * Without them the agent could still do image-to-image — `generate_ai_image` takes
 * `referenceImageUrls` — but only from a URL the user pasted, and it wrote prompts
 * blind to the vertical rules. So the same request produced a better image through
 * the UI than through the agent. These two tools close that gap.
 */
export function createReferenceCreativeTools(supabase: SupabaseClient, userId: string) {
  return {
    list_reference_creatives: tool({
      description:
        'List reference creatives for this business. ' +
        'FIRST it returns the account\'s OWN uploaded references (the ones in their reference library — their real brand ' +
        'style). Only if they have none, or if they explicitly ask to see built-in examples, does it fall back to the ' +
        'app\'s 35 built-in luxury real-estate designs. ' +
        'Treat any reference as a DESIGN reference, not content — keep the layout, typography, framing and surface ' +
        'treatment, and replace the place, the brand marks and any claims with the client\'s own. ' +
        'Never present a reference image as if it were the client\'s actual property, and never describe a built-in ' +
        'example as this client\'s brand.',
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
        includeExamples: z
          .boolean()
          .default(false)
          .describe(
            'Only set this when the owner explicitly asks to see built-in example designs. The built-ins are ' +
              'real-estate creative and are NOT this client\'s brand.'
          ),
      }),
      execute: async ({ category, library, limit, includeExamples }) => {
        const cat = (category || '').toLowerCase();

        /**
         * THE TENANT'S OWN REFERENCES COME FIRST, AND THE BUILT-INS ARE OPT-IN.
         *
         * Measured for one account: 35 built-in references beside its own 19 uploads, and this tool only ever read the
         * built-ins — so a film academy asking for "a creative like this one" was shown estate-agent designs while its
         * own, on-brand uploads were invisible. The built-in catalogue is a demo shelf, not anybody's brand, so it is
         * reachable only when the caller asks for examples.
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
          if (!includeExamples) {
            return {
              success: true,
              source: 'none',
              count: 0,
              message:
                'This account has no reference creatives of its own yet. Do not substitute built-in examples — build ' +
                'from the brand kit and the brief, and tell the owner they can add references in the Reference Library. ' +
                'If they explicitly ask to see example designs, call this again with includeExamples: true.',
            };
          }
        } catch {
          /* a failed lookup falls through to the built-in shelf below, which is what the caller asked for anyway */
        }

        const matches = ALL_REFERENCE_TEMPLATES.filter(
          (t) =>
            (library === 'all' || t.libraryCategory === library) &&
            (!cat || t.category.toLowerCase().includes(cat) || t.name.toLowerCase().includes(cat))
        );

        if (!matches.length) {
          const cats = [...new Set(ALL_REFERENCE_TEMPLATES.map((t) => t.category))].sort();
          return {
            success: true,
            count: 0,
            availableCategories: cats,
            message: `No reference creatives matched "${category}". Available categories: ${cats.join(', ')}.`,
          };
        }

        return {
          success: true,
          count: Math.min(matches.length, limit),
          totalMatched: matches.length,
          creatives: matches.slice(0, limit).map((t) => ({
            id: t.id,
            name: t.name,
            category: t.category,
            library: t.libraryCategory,
            badge: t.badge,
            description: t.description,
            url: t.url,
            fallbackUrl: t.fallbackImage,
          })),
          designLanguage: {
            sum:
              'Luxury architectural advertising: full-bleed hero architecture, a short uppercase badge, one ' +
              'dominant sell-line, a fine tracked sub-line, and a single high-contrast CTA.',
            recurring: [
              'Badge lockup top or upper-left — small, wide tracking, uppercase',
              'One dominant word or numeral carrying the whole layout',
              'Warm cream / sand / gold type over deep architectural imagery',
              'A price or a single number given its own heavy weight',
              'Quiet footer: developer mark, contact, legal line',
            ],
          },
          mustAdapt: {
            why: 'These are Dubai / Emirates designs. The craft transfers; the specifics do not.',
            replacePlaces: ['Dubai', 'Palm Jumeirah', 'Emirates', 'Creek Harbour', 'Marina', 'Downtown'],
            stripBrands: ['DAMAC', 'Emaar', 'Atlantis', 'any developer mark that is not the client\'s'],
            stripClaims: [
              '0% tax',
              'guaranteed returns',
              'guaranteed ROI',
              'freehold title',
              'post-handover payment plan',
              'highest rental yield',
              'AED pricing',
            ],
            rule:
              'Where the reference made one of these claims, replace it with a fact from the client\'s own ' +
              'record or drop the element. Never carry a Dubai claim onto an Indian project, and never invent ' +
              'the replacement.',
          },
          howToUse:
            'Pass the chosen url as referenceImageUrls to generate_ai_image. Describe the change you want ' +
            '(the property, the offer, the brand colours) and keep the reference\'s layout, framing and type ' +
            'positioning. Say plainly that the reference is a style guide, not the actual property.',
        };
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
