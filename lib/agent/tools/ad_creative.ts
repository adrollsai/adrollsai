/**
 * The ad-creative compiler, as a tool.
 *
 * The prompt has told the agent for a long time to make ads that convert; this is the part that makes that
 * checkable instead of aspirational. The agent supplies the brief, this returns the argument to make, the copy,
 * the complete image prompt, the layout in pixels and the checklist to verify against — so "make me an ad for
 * the November batch" stops being a picture of a camera and starts being a message with a hierarchy.
 *
 * It fills the business's own details from the profile rather than asking the model to remember them, because a
 * wrong phone number in a client's ad is the kind of mistake that gets an account suspended.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AD_FORMATS, AD_ANGLES, composeAdCreative, type AdFormat } from '@/lib/agent/creative/ad-prompt-compiler';
import { applyDirectivesToSpec, mergeDirectives } from '@/lib/automation/creative-directives';

export function createAdCreativeTools(supabase: SupabaseClient, userId: string) {
  return {
    build_ad_creative_prompt: tool({
      description:
        'Turn an ad brief into the exact prompt and layout for a high-converting Meta ad. Call this BEFORE writing ' +
        'an ad, a poster, an offer card or a reel — every time, whether or not a reference was supplied, because a ' +
        'reference decides the LOOK and this decides the ARGUMENT. It picks a conversion angle that the supplied ' +
        'facts actually support, writes the headline and subhead, states the offer, chooses the call to action, ' +
        'and returns: a complete imagePrompt to hand to generate_ai_image (or to build in HTML), a layout with real ' +
        'pixel type sizes and safe areas, a measured contrast verdict, video beats for 9:16, and a checklist. ' +
        'Anything the business has not told you comes back as [NEEDS: …] in `needs` — ask for it or drop that ' +
        'angle. NEVER invent a claim, a statistic, a deadline or a placement rate to fill one.',
      inputSchema: z.object({
        product: z.string().min(2).describe('What is being advertised, in the business\'s own words'),
        offer: z
          .string()
          .optional()
          .describe('The offer exactly as it should appear, e.g. "₹15,000 off the November batch". Omit if there is none.'),
        audience: z.string().optional().describe('Who it is for, e.g. "aspiring cinematographers in Chandigarh"'),
        place: z.string().optional().describe('The town or city the business actually serves'),
        format: z
          .enum(['1:1', '4:5', '9:16', '16:9'])
          .default('4:5')
          .describe('4:5 for feed (default), 9:16 for reels/stories, 1:1 square, 16:9 landscape'),
        cta: z
          .enum(['call', 'whatsapp', 'visit', 'apply', 'book'])
          .optional()
          .describe('The single action. Defaults to call when the business has a phone number, else visit'),
        facts: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Only facts the business actually supplied, e.g. { seats: "20", deadline: "30 November", ' +
              'proof: "Priya cleared her exam in one attempt", authority: "15 years on set", ' +
              'outcome: "6 months to a showreel", objection: "hidden fees" }. Anything missing is flagged.',
          ),
        avoid: z
          .array(z.string())
          .optional()
          .describe('Angles or claims the owner has rejected — pass them back so they are not repeated'),
        itemId: z
          .string()
          .optional()
          .describe(
            'The catalogue item (project, course, package) this creative is for. Item-scoped creative directives - "this project always shows the site plan", "no phone number on this one" - are applied only when it is given. The legacy name propertyId is accepted too.'
          ),
        propertyId: z.string().optional().describe('Alias of itemId, kept for older prompts'),
        campaignId: z.string().optional().describe('Campaign-scoped creative directives, when the creative belongs to one'),
      }),
      execute: async ({ product, offer, audience, place, format, cta, facts, avoid, itemId, propertyId, campaignId }: any) => {
        const catalogueItemId = itemId || propertyId;
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('business_name, industry, brand_color, contact_number')
            .eq('id', userId)
            .maybeSingle();

          // THE OWNER'S STANDING RULES, APPLIED IN CODE.
          //
          // "for this property, such and such every time" and "no phone number on any daily creative" are
          // directives on the playbook. They are not forwarded to the model as advice: the bans are
          // enforced on the compiled spec here and the result is checked afterwards. A creative that still
          // contains a banned element comes back with `violations` set and must not be shipped.
          const { getActivePlaybook } = await import('@/lib/automation/ceo');
          const playbook: any = await getActivePlaybook(supabase as any, userId).catch(() => null);
          const merged = mergeDirectives((playbook as any)?.creative_directives ?? null, { propertyId: catalogueItemId, campaignId });

          const baseSpec = composeAdCreative({
            product,
            offer,
            audience,
            place: place || undefined,
            format: (format || '4:5') as AdFormat,
            cta,
            facts: facts || {},
            brandColor: profile?.brand_color || null,
            // A banned phone is not passed in at all: the compiler turns a contact into the call CTA and
            // prints the number into the image instructions, so stripping it later would leave "Call" with
            // nothing to call.
            contact: merged.bans.includes('phone') ? null : profile?.contact_number || null,
            businessName: profile?.business_name || 'the business',
            industry: profile?.industry || null,
            avoid,
          });

          const directed = applyDirectivesToSpec(baseSpec as any, merged);
          const spec = directed.value as any;

          const notes: string[] = [];
          if (merged.instructions.length || merged.bans.length) {
            notes.push(
              `Standing creative directives applied (${merged.sources.join('; ')}): ` +
                `${merged.instructions.join(' | ') || '(no prose rules)'}. ` +
                `Hard bans enforced: ${merged.bans.join(', ') || 'none'}.` +
                (directed.applied.length ? ` What that changed: ${directed.applied.join('; ')}.` : ''),
            );
          }
          if (directed.violations.length) {
            notes.push(
              `NOT SAFE TO SHIP: the compiled creative still breaks these rules — ${directed.violations.join('; ')}. ` +
                'Fix the copy yourself or drop the offending line, then compose again.',
            );
          }
          if (spec.needs.length) {
            notes.push(
              `Ask the owner for ${spec.needs.join(', ')} before building — or choose a different angle with ` +
                '`avoid` so the ad makes no claim it cannot support.',
            );
          }
          if (spec.layout.contrast.actual !== null && spec.layout.contrast.actual < 4.5) {
            notes.push(`Contrast ${spec.layout.contrast.actual}:1 fails — ${spec.layout.contrast.verdict}.`);
          }
          if (!profile?.contact_number) {
            notes.push('No phone number on the profile, so the CTA says "visit". Set the number if this ad should convert by call.');
          }

          return {
            success: true,
            ...spec,
            formats: Object.keys(AD_FORMATS),
            angles: AD_ANGLES.map((a) => ({ id: a.id, name: a.name, needs: a.requires })),
            howToUse:
              'Pass `imagePrompt` to generate_ai_image as the prompt (append a reference image URL if the owner ' +
              'supplied one — the reference changes the LOOK, not this structure). If you build the creative in ' +
              'HTML instead, implement `layout` exactly: those pixel sizes and safe margins are what make it ' +
              'legible at feed size. Then call sandbox_preview_hyperframes or check the image against `checklist` ' +
              'before you show it. Say which angle you chose and why in your reply.',
            notes,
          };
        } catch (err: any) {
          return { success: false, error: String(err?.message || err) };
        }
      },
    }),
  };
}
