/**
 * The planner, as a tool the agent calls before it makes anything.
 *
 * This is the philosophy in one tool: read the business's real state, decide what work is worth doing from the owner's
 * own words, and hand back a plan with the assumptions named and the open questions listed. Execution stays with the
 * agent and its existing tools — the plan is the spine, not a script.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assembleBusinessContext, describeContext, planBusinessWork } from '@/lib/agent/creative/business-plan';

export function createBusinessPlanTools(supabase: SupabaseClient, userId: string, model: any) {
  return {
    plan_business_work: tool({
      description:
        'PLAN BEFORE MAKING ANYTHING. Reads this business\'s live state — who it is, its industry, its catalogue and ' +
        'prices, its own imagery, its last 30 days of leads, calls and bookings, what is running right now, its credits ' +
        'and any standing instructions from the owner — and turns that plus the owner\'s request into a work plan: the ' +
        'objective, the audience, the offer, the thesis, exactly which artefacts to make and in what order, each with a ' +
        'one-line brief; the assumptions it had to make; the questions only the owner can answer; and the number that ' +
        'would prove it worked. Call this FIRST for any marketing request — an ad, a page, a site, a video, a campaign, ' +
        'a follow-up flow. Then execute the plan with your tools, in the order it gives. If it lists QUESTIONS, ask them ' +
        'before building. If it lists ASSUMPTIONS, state them when you deliver.',
      inputSchema: z.object({
        request: z
          .string()
          .min(3)
          .describe('What the owner asked for, in their own words, including any specifics they gave (offer, date, product)'),
        alsoRead: z
          .boolean()
          .default(true)
          .describe('Include the readable summary of the business state in the result, so you can cite real numbers'),
      }),
      execute: async ({ request, alsoRead }) => {
        try {
          const context = await assembleBusinessContext(supabase, userId);
          const plan = await planBusinessWork({ context, request, model });

          const notes: string[] = [];
          if (plan.questions.length) {
            notes.push(`Ask the owner: ${plan.questions.join('; ')}. Do not invent the answers.`);
          }
          if (context.gaps.length) {
            notes.push(`Limits of this plan: ${context.gaps.join('; ')}.`);
          }
          if (!plan.artefacts.length) {
            notes.push('The plan named no artefacts, so it is not a plan yet. Re-run with a more specific request.');
          }

          return {
            success: true,
            plan: {
              objective: plan.objective,
              audience: plan.audience,
              offer: plan.offer,
              thesis: plan.thesis,
              artefacts: plan.artefacts,
              order: plan.order,
              success_metric: plan.successMetric,
            },
            assumptions: plan.assumptions,
            questions: plan.questions,
            ...(alsoRead
              ? {
                  business_state: {
                    summary: describeContext(context),
                    catalogue: context.catalogue,
                    assets: context.assets,
                    performance: context.performance,
                    running_now: context.runningNow,
                    capacity: context.capacity,
                    gaps: context.gaps,
                  },
                }
              : {}),
            notes,
            howToUse:
              'Now execute in this order with your own tools: build the brief for each artefact from the plan, use the ' +
              'design and creative skills for craft, verify every artefact before showing it (screenshot a page, check a ' +
              'film carries audio and passes check, look at a creative), and report against the success metric. ' +
              'Do not substitute a different artefact than the plan names without saying why.',
          };
        } catch (err: any) {
          return { success: false, error: String(err?.message || err) };
        }
      },
    }),
  };
}
