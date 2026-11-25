/* eslint-disable @typescript-eslint/no-explicit-any -- Meta rows and tool inputs are untyped. */
/**
 * The composed ad tools: the ordinary request, done the way the product already does it.
 *
 * These sit ON TOP of the primitives, never instead of them:
 *   - `launch_meta_campaign`   - a normal campaign from a brief (objective/optimisation/lead form from the plan).
 *   - `launch_meta_retargeting` - audience -> campaign that targets only that audience, in one action.
 *   - `optimize_meta_campaign`  - read performance, then a short list of actions with the exact primitive call.
 *
 * `meta_graph_create/update/query` stay registered and are the answer for anything these do not cover: special ad
 * categories, bid strategies, unusual placements, catalog/DPA structures, rules, pixels, custom conversions. A
 * composed path that pretended to be the only way would be a regression.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  MIN_DAILY_BUDGET_INR,
  describePlan,
  launchCampaignAsAgent,
  launchRetargetingAsAgent,
  loadRecordedLaunches,
  recommendOptimisation,
  resolveLaunchContext,
  validateLaunchRequest,
} from '@/lib/ads/launch-service';
import { CAMPAIGN_GOALS, CONVERSION_EVENTS, LEAD_FORM_FIELDS } from '@/lib/ads/campaign-plan';
import { attributePerformance, angleGuidance, deriveResults, summariseLearnings } from '@/lib/ads/creative-learning';

const locationSchema = z.object({
  key: z.string().describe('Meta geo key: a numeric city key, a region key, or an ISO country code'),
  type: z.enum(['city', 'region', 'country', 'zip', 'custom']),
  country_code: z.string().optional(),
  radius: z.number().optional().describe('For a city: radius in km'),
});

const targetSchema = {
  locations: z.array(locationSchema).optional().describe('Where to show it. Omit for the account default (India).'),
  gender: z.enum(['all', 'male', 'female']).optional(),
  ageMin: z.number().optional().describe('13-65'),
  ageMax: z.number().optional().describe('13-65'),
  interests: z
    .array(z.any())
    .optional()
    .describe('Meta detailed-targeting entries: [{id, name}]. Resolve them with meta_graph_search_targeting, never invent ids.'),
};

export function createComposedAdTools(supabase: SupabaseClient, userId: string) {
  const db = supabase as any;

  return {
    get_ads_readiness: tool({
      description:
        'Whether this business can launch ads at all right now: the connected Meta account, ad account, page, pixel, currency, WhatsApp number and the site URL the ads will point at. Call this FIRST for any ads request - a launch attempted without these fails inside Meta with a code nobody can act on.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const context = await resolveLaunchContext(db, userId);
          return {
            ok: true,
            canLaunch: context.ok,
            missing: context.missing || [],
            account: context.ctx
              ? {
                  adAccountId: context.ctx.adAccountId,
                  pageId: context.ctx.pageId,
                  pixelId: context.ctx.pixelId,
                  currency: context.ctx.currency,
                  linkUrl: context.ctx.linkUrl,
                  whatsappNumber: context.ctx.whatsappNumber || null,
                  businessName: context.ctx.businessName,
                }
              : null,
            minimumDailyBudget: `${MIN_DAILY_BUDGET_INR} per day`,
            goals: CAMPAIGN_GOALS.map((g) => ({ id: g.id, label: g.label, blurb: g.blurb })),
            conversionEvents: CONVERSION_EVENTS.map((e) => e.value),
            leadFormFields: LEAD_FORM_FIELDS.map((f) => ({ id: f.id, label: f.label })),
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'could not read the ads setup' };
        }
      },
    }),

    launch_meta_campaign: tool({
      description:
        'Launch a Meta ad campaign from a brief, using this product\'s own campaign pipeline: it resolves the objective, the ad-set optimisation, whether an instant lead form is needed and which questions it carries, then creates the campaign, ad set, creatives and ads. This is the DEFAULT for "run a campaign / get me leads / advertise this". It needs a budget, a creative and a destination; anything missing comes back as one combined question and NOTHING is created. New campaigns are created in the account\'s currency. For anything this tool does not expose (special ad categories, bid strategies, unusual placements, catalogue/DPA structures), use the primitives meta_graph_create / meta_graph_update instead - they remain available. Requires the owner\'s approval: it spends real money.',
      inputSchema: z.object({
        campaignName: z.string().describe('Name the owner will recognise'),
        dailyBudget: z.number().describe(`Daily budget in the account currency, major units (500 = 500.00). Minimum ${MIN_DAILY_BUDGET_INR}.`),
        campaignGoal: z
          .enum(['leads', 'quality_leads', 'conversions', 'whatsapp'])
          .optional()
          .describe('leads = instant form; quality_leads = same form optimised for qualified leads; conversions = website + pixel; whatsapp = chat ads'),
        conversionEvent: z
          .string()
          .optional()
          .describe(`For campaignGoal=conversions: one of ${CONVERSION_EVENTS.map((e) => e.value).join(', ')}`),
        creativeUrls: z.array(z.string()).optional().describe('Public image/video URLs to run as the ad'),
        inventoryIds: z.array(z.string()).optional().describe('Catalogue/property ids whose media and copy should be used'),
        assetIds: z.array(z.string()).optional().describe('Uploaded media asset ids'),
        adCopy: z
          .object({
            headline: z.string().optional().describe('Max 40 characters — Meta truncates the rest silently'),
            primary_text: z.string().optional().describe('Only the first ~125 characters show before "See more"'),
            description: z.string().optional().describe('Max 30 characters recommended'),
          })
          .optional()
          .describe('Omit and the pipeline writes the copy from the business profile and the catalogue. Copy over a limit, or carrying a banned stock phrase, is REFUSED before anything is created.'),
        creativePlan: z
          .object({
            angleId: z
              .string()
              .optional()
              .describe('The angle from build_ad_creative_prompt (offer-first, proof, local, ...). Recorded so this campaign\'s results can be attributed to it.'),
            headline: z.string().optional(),
            subhead: z.string().optional(),
            offerLine: z.string().optional(),
            format: z.string().optional().describe('1:1, 4:5, 9:16 or 16:9'),
          })
          .optional()
          .describe('What this launch is ARGUING. Pass the angle build_ad_creative_prompt chose — without it the campaign\'s performance cannot be learned from.'),
        ...targetSchema,
        leadFormFields: z
          .array(z.string())
          .optional()
          .describe(`Instant-form questions, ids from ${LEAD_FORM_FIELDS.map((f) => f.id).join(', ')}. Defaults to FULL_NAME, PHONE, CITY.`),
        pixelId: z.string().optional().describe('Required for a conversions campaign when the profile has none'),
        whatsappNumber: z.string().optional().describe('Required for WhatsApp chat ads'),
        linkUrl: z.string().optional().describe('Landing URL; defaults to the business site'),
        customAudienceIds: z
          .array(z.string())
          .optional()
          .describe('Retarget these Meta audiences only. Prefer launch_meta_retargeting, which creates the audience too.'),
        startPaused: z.boolean().optional().describe('Create the campaign paused so the owner can review it first'),
      }),
      execute: async (input: any) => {
        try {
          const angleId = input?.creativePlan?.angleId ? String(input.creativePlan.angleId) : null;

          /**
           * THE ONE LAUNCH THAT IS REFUSED.
           *
           * On an account whose daily job is switched on, a launch with no recorded argument is refused
           * outright. The reasoning is the whole point of the learning loop: a campaign that does not say
           * what it argued is money that can never be learned from, so the second month repeats the first
           * month's mistakes at the owner's expense. When a machine is spending on its own schedule, it
           * does not get to spend blind.
           *
           * Scoped deliberately. An account with no routine running keeps the old behaviour — a person
           * asking for an ad at 11pm should get their ad, not a lecture about attribution. The refusal is
           * recoverable inside the same turn: call build_ad_creative_prompt, take its angle id, launch again.
           */
          if (!angleId) {
            try {
              const { data: routine } = await db
                .from('business_routines')
                .select('enabled')
                .eq('user_id', userId)
                .eq('enabled', true)
                .limit(1)
                .maybeSingle();
              if (routine?.enabled) {
                return {
                  ok: false,
                  refused: 'attribution-missing',
                  error:
                    'REFUSED: this account runs its marketing daily, so every campaign must record which argument it makes — ' +
                    'otherwise its results can never be learned from and next month starts from zero again. ' +
                    'Call build_ad_creative_prompt first (it returns the angle it chose, plus the headline and image prompt), ' +
                    'then launch again with creativePlan.angleId set to that id. Nothing was created and nothing was spent.',
                  attribution: { recorded: false, angleId: null },
                };
              }
            } catch {
              // If the routine cannot be read, do not block a person's launch on it.
            }
          }

          const result = await launchCampaignAsAgent(db, userId, input);
          if (!result.ok) return result;
          /**
           * DID THIS LAUNCH TEACH THE LOOP ANYTHING?
           *
           * A launch that does not record which argument its creative made is money that can never be
           * learned from: `attributePerformance` has nothing to join the spend to, so the rows land in
           * `unattributedSpend` and next month starts from zero again. That used to happen silently —
           * the agent got `ok: true` with no way to know it had just spent money blind.
           *
           * So the result now says which it was, in the same words every time. Not a warning to be
           * skimmed: either the caller passes creativePlan.angleId (the id build_ad_creative_prompt
           * returned) or it is told, on the record, that this campaign is unlearnable.
           */
          return {
            ...result,
            attribution: {
              recorded: Boolean(angleId),
              angleId,
              consequence: angleId
                ? `Results from this campaign will be attributed to "${angleId}", so next week's report can say whether that argument worked.`
                : 'This campaign CANNOT be learned from: no angle was recorded, so its spend cannot be tied to what the ad argued. ' +
                  'Pass creativePlan.angleId — the id build_ad_creative_prompt returned — on the next launch.',
            },
            planText: result.plan ? describePlan(result.plan, String(result.summary?.currency || 'INR')) : null,
            message:
              `${result.message} Campaign id ${result.campaignId}.` +
              (angleId ? '' : ' ATTRIBUTION NOT RECORDED — see `attribution`.') +
              ' Read it back with meta_graph_insights or the ads screen before promising any result.',
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'the campaign launch failed before anything was created' };
        }
      },
    }),

    launch_meta_retargeting: tool({
      description:
        'Retargeting in one action: build (or reuse) a Meta custom audience from this business\'s own leads/phones, then launch a campaign that targets ONLY that audience. Use it for "retarget my qualified leads", "run ads to people who enquired", "re-engage everyone from the Diwali campaign". The audience is created with the same tool that hashes phone numbers and reads CRM groups (meta_custom_audience_create); the campaign goes through the same launch pipeline as a fresh one. Nothing is created and no money is spent if the audience cannot be built. Requires the owner\'s approval.',
      inputSchema: z.object({
        audience: z
          .object({
            source: z.enum(['existing', 'crm_leads', 'phones', 'lookalike']),
            audienceId: z.string().optional().describe('source=existing: a Meta custom audience id'),
            audienceGroupName: z.string().optional().describe('source=crm_leads: a saved CRM audience group'),
            filters: z.record(z.string(), z.any()).optional().describe('source=crm_leads: filters instead of a saved group'),
            phones: z.array(z.string()).optional().describe('source=phones'),
            emails: z.array(z.string()).optional(),
            originAudienceId: z.string().optional().describe('source=lookalike: the audience to model on'),
            ratio: z.number().optional().describe('source=lookalike: 0.01 = 1%'),
            country: z.string().optional().describe('source=lookalike: IN'),
            name: z.string().optional().describe('Audience name the owner will recognise'),
          })
          .describe('Where the retargeting audience comes from'),
        campaignName: z.string().describe('Name for the retargeting campaign'),
        dailyBudget: z.number().describe(`Daily budget in the account currency. Minimum ${MIN_DAILY_BUDGET_INR}.`),
        creativeUrls: z.array(z.string()).optional(),
        inventoryIds: z.array(z.string()).optional(),
        assetIds: z.array(z.string()).optional(),
        adCopy: z
          .object({ headline: z.string().optional(), primary_text: z.string().optional(), description: z.string().optional() })
          .optional(),
        campaignGoal: z.enum(['leads', 'quality_leads', 'conversions', 'whatsapp']).optional(),
        conversionEvent: z.string().optional(),
        pixelId: z.string().optional(),
        whatsappNumber: z.string().optional(),
        gender: z.enum(['all', 'male', 'female']).optional(),
        ageMin: z.number().optional(),
        ageMax: z.number().optional(),
        startPaused: z.boolean().optional(),
      }),
      execute: async ({ audience, ...request }: any) => {
        try {
          const result = await launchRetargetingAsAgent(db, userId, request, audience);
          if (!result.ok) return result;
          return {
            ...result,
            message:
              `${result.message} Retargeting audience ${result.audienceId} (${result.audienceNote}); campaign ${result.campaignId}. ` +
              'Meta needs a few hours to populate a new audience before the ad set can spend against it.',
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'the retargeting launch failed before anything was created' };
        }
      },
    }),

    optimize_meta_campaign: tool({
      description:
        'Read a campaign\'s real performance and say what to do about it: which ad sets/ads to pause, which to keep and where budget belongs. ALSO says what to make NEXT: it joins each row to the angle that launch recorded, so it returns per-angle learnings (which argument is winning, which has already lost) that you pass into build_ad_creative_prompt. Returns the ACTIONS plus the exact primitive call for each (meta_graph_set_status / meta_graph_update) - it does not move a client\'s budget by itself, and it never invents a number. Call it before recommending any budget change AND before writing a new batch of creatives, so the next batch is built on what actually worked.',
      inputSchema: z.object({
        campaignId: z.string().optional().describe('Restrict the analysis to one campaign'),
        level: z.enum(['campaign', 'adset', 'ad']).default('adset').describe('What to judge. "ad" gives the finest attribution to an angle.'),
        datePreset: z
          .enum(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'maximum'])
          .default('last_7d'),
        minSpendForJudgement: z
          .number()
          .optional()
          .describe('Do not judge an item below this spend in the account currency (default 500)'),
      }),
      execute: async ({ campaignId, level, datePreset, minSpendForJudgement }: any) => {
        try {
          const { createMetaGraphTools } = await import('@/lib/agent/mcp/meta-graph');
          const graphTools: any = createMetaGraphTools(db, userId);
          const insights = await graphTools.meta_graph_insights.execute({
            level: level || 'adset',
            datePreset: datePreset || 'last_7d',
            campaignId: campaignId || undefined,
            limit: 50,
          });
          if (!insights?.success) {
            return { ok: false, error: insights?.error || 'could not read the insights - nothing was changed' };
          }

          /**
           * THE NUMBERS, NOT THE LABELS.
           *
           * `insights.rows` is built for reading — money as "₹2,000.00", CTR as "1.25%", and no ids. Judging
           * those produced NaN against every threshold, so this tool used to answer "nothing has crossed the
           * spend threshold" whatever the account was doing. `insights.raw` is Meta's own payload: numeric
           * and id-bearing.
           *
           * `results` is then derived rather than left absent. Meta has no results field — it has an `actions`
           * array — and `recommendOptimisation` pauses anything that spent money with `results === 0`. Passing
           * raw rows through untouched would therefore mark every single row "spent with no results at all" and
           * recommend pausing the entire account.
           */
          const usedRaw = Array.isArray(insights.raw) && insights.raw.length > 0;
          const sourceRows: any[] = usedRaw
            ? insights.raw
            : Array.isArray(insights.rows)
              ? insights.rows
              : [];
          const numericRows: any[] = sourceRows.map((row) => ({ ...row, results: deriveResults(row) }));
          const actions = recommendOptimisation(numericRows, { minSpendForJudgement });

          // ── the other half of the loop: what the numbers mean for the NEXT batch ──────────────────
          const recorded = await loadRecordedLaunches(db, userId, { limit: 100 });
          const attributed = attributePerformance(numericRows, recorded.launches);
          const learnings = summariseLearnings(attributed.observations, {
            period: datePreset || 'last_7d',
            currency: insights.currency || 'INR',
            ...(minSpendForJudgement ? { minSpend: Number(minSpendForJudgement) } : {}),
          });
          learnings.unattributedRows = attributed.unattributedRows;
          learnings.unattributedSpend = attributed.unattributedSpend;
          if (!learnings.summary) learnings.summary = 'No learnings yet.';
          const guidance = angleGuidance(learnings);

          const notes: string[] = [
            'These are recommendations with the primitive call attached. Applying one is a separate, gated step: ' +
              'call the named primitive (meta_graph_set_status / meta_graph_update) and the review card will carry it.',
          ];
          if (!usedRaw) {
            notes.push(
              'The provider returned no raw rows, so this pass read the DISPLAY rows: money arrives pre-formatted and ' +
                'the entity ids are gone. Treat the budget actions as indicative, and expect nothing to be attributable ' +
                'to an angle until raw rows are available.',
            );
          }
          if (recorded.readError) {
            notes.push(`Could not read recorded launches (${recorded.readError}), so nothing could be attributed to an angle.`);
          } else if (!recorded.launches.length) {
            notes.push(
              'No launch has recorded a creativePlan yet, so no spend could be tied to an angle. Pass creativePlan.angleId ' +
                'on the next launch and this pass will start learning.',
            );
          }
          if (attributed.unattributedRows) {
            notes.push(
              `${attributed.unattributedRows} row(s) (${attributed.unattributedSpend.toFixed(0)} ${learnings.currency}) could not ` +
                'be attributed to an angle - they were launched before plans were recorded, or outside this platform. They are ' +
                'NOT included in the angle verdicts.',
            );
          }

          return {
            ok: true,
            analysed: numericRows.length,
            currency: insights.currency || 'INR',
            period: datePreset || 'last_7d',
            actions,
            learnings,
            guidance,
            note: notes.join(' '),
            howToUseLearnings:
              'Pass guidance.avoid ids into build_ad_creative_prompt as `avoidAngles`, and prefer guidance.prefer when ' +
              'choosing an angle. Then pass the chosen angle back as creativePlan.angleId on the launch, which is what ' +
              'keeps this loop turning. The owner\'s explicit instruction always wins over a measurement.',
            rows: insights.rows,
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'the optimisation pass failed - nothing was changed' };
        }
      },

    }),
  };
}

/** Names this module registers, so a gate can assert they are actually wired. */
export const COMPOSED_AD_TOOLS = [
  'get_ads_readiness',
  'launch_meta_campaign',
  'launch_meta_retargeting',
  'optimize_meta_campaign',
  'ad_launchpad',
] as const;
