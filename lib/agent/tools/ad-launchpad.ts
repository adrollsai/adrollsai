/* eslint-disable @typescript-eslint/no-explicit-any -- tool inputs and Supabase rows are untyped. */
/**
 * The ads launchpad, as a conversation.
 *
 * THE COMPLAINT THIS ANSWERS
 * Asking for a campaign in chat produced a competent launch hand-built from primitives: different
 * questions from the Ads tab, no pickers, and a wall of text to type. The product already HAS a
 * launchpad — the fix is to route the chat through it, not to write a second one.
 *
 * HOW IT WORKS
 * One tool, called once per question with the answers so far. It returns the next question as a
 * `user_input_prompt` artifact, which the chat renders as tappable buttons plus a free-text box (a tap
 * sends that answer straight back), and when nothing is left to ask it returns the exact input
 * `launch_meta_campaign` takes. That means the launch itself runs the same plan, preflight and
 * processor as the Ads screen, and the approval card still stands between this and any spend.
 *
 * The questions themselves — order, options, parsing, and the mapping to a launch — live in
 * `lib/ads/launchpad.ts`, where they are pure and gated.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { MIN_DAILY_BUDGET_INR } from '@/lib/ads/launch-service';
import {
  launchpadProgress,
  launchpadToLaunchInput,
  nextLaunchpadQuestion,
  readLaunchpadAnswer,
  type LaunchpadAnswers,
  type LaunchpadContext,
  type LaunchpadStep,
} from '@/lib/ads/launchpad';

const STEP_VALUES = ['goal', 'creative_source', 'assets', 'product', 'budget', 'instructions'] as const;

export function createAdLaunchpadTools(supabase: SupabaseClient, userId: string) {
  const db = supabase as any;

  /** What this account can actually offer, so no question asks for something that does not exist. */
  async function loadContext(): Promise<LaunchpadContext> {
    const ctx: LaunchpadContext = { currency: 'INR', minDailyBudget: MIN_DAILY_BUDGET_INR };

    try {
      const { data: profile } = await db
        .from('profiles')
        .select('currency, whatsapp_phone_number_id')
        .eq('id', userId)
        .maybeSingle();
      if (profile?.currency) ctx.currency = String(profile.currency);
      ctx.canWhatsApp = Boolean(profile?.whatsapp_phone_number_id);
    } catch {
      // A profile read failure must not stop the conversation; the defaults are honest.
    }

    try {
      // Library options are the point of the picker: an owner recognises their own images by name, and a
      // campaign built on the wrong property photo is money set on fire.
      const { data: assets } = await db
        .from('assets')
        .select('id, url, type, caption, created_at')
        .eq('user_id', userId)
        .in('type', ['image', 'video'])
        .order('created_at', { ascending: false })
        .limit(12);
      ctx.library = (assets ?? []).map((asset: any, index: number) => ({
        id: String(asset.id),
        label: String(asset.caption || `${asset.type ?? 'image'} ${index + 1}`).slice(0, 60),
        kind: String(asset.type ?? 'image'),
      }));
    } catch {
      ctx.library = [];
    }

    try {
      const { data: products } = await db.from('inventory').select('id, title, name').eq('user_id', userId).limit(8);
      ctx.products = (products ?? [])
        .map((product: any) => ({ id: String(product.id), label: String(product.title || product.name || '').trim() }))
        .filter((product: any) => product.label);
    } catch {
      ctx.products = [];
    }

    return ctx;
  }

  return {
    ad_launchpad: tool({
      description:
        'The HEADSTART for any "launch an ad campaign / get me leads / run an ad" request. Walks the owner through the ' +
        'same launchpad the Ads tab uses, one question at a time, with the answers offered as tappable options (and a ' +
        'free-text box on every question, so they can say anything the launchpad has no field for). ' +
        'Call it with NO answers to begin: it returns the next question plus a user_input_prompt artifact the chat ' +
        'renders as buttons and an input box. When the owner replies, call it again with the accumulated answers plus ' +
        'what they just said. When it returns ready:true, call launch_meta_campaign with the launch input it gives you — ' +
        'do not re-ask those questions, and do not hand-build the campaign from primitives while the launchpad fits. ' +
        'Go straight to launch_meta_campaign only when the owner has already answered everything unprompted.',
      inputSchema: z
        .object({
          answers: z
            .object({
              goal: z.enum(['leads', 'quality_leads', 'conversions', 'whatsapp']).optional(),
              creativeSource: z.enum(['library', 'upload', 'agent']).optional(),
              assetIds: z.array(z.string()).optional(),
              creativeUrls: z.array(z.string()).optional(),
              productIds: z.array(z.string()).optional(),
              dailyBudget: z.number().optional(),
              instructions: z.string().optional(),
              startPaused: z.boolean().optional(),
            })
            .optional()
            .describe('Everything the owner has told you so far. Omit to start from the top.'),
          justAnswered: z
            .string()
            .optional()
            .describe(
              'The owner\'s latest reply, verbatim — a tapped option label or something they typed. Parsed against the ' +
                'question that was asked, so pass it as-is rather than summarising it.'
            ),
          lastStep: z
            .enum(STEP_VALUES)
            .optional()
            .describe('Which question justAnswered was answering. Omit on the first call.'),
        })
        .passthrough(),
      execute: async (input: any) => {
        try {
          const answers: LaunchpadAnswers = { ...(input?.answers ?? {}) };
          const ctx = await loadContext();

          let acknowledged: string | null = null;
          if (input?.justAnswered && input?.lastStep) {
            const step = input.lastStep as LaunchpadStep;
            const parsed = readLaunchpadAnswer(step, String(input.justAnswered), ctx);
            const learned = Object.keys(parsed).length > 0;
            Object.assign(answers, parsed);

            if (!learned) {
              /**
               * They said something the options did not cover. That is not a failure: take it as a free-text
               * instruction and carry on, rather than bouncing the same buttons back at them. The agent can do
               * things the launchpad has no field for, and this is where that shows up.
               */
              answers.instructions = [answers.instructions, String(input.justAnswered).trim()].filter(Boolean).join('. ');
              acknowledged = `Recorded as an instruction: "${String(input.justAnswered).trim().slice(0, 200)}"`;
            } else {
              acknowledged = `Recorded for ${step}`;
            }
          }

          const question = nextLaunchpadQuestion(answers, ctx);
          const progress = launchpadProgress(answers, ctx);

          if (!question) {
            const readiness = launchpadToLaunchInput(answers, ctx);
            if (!readiness.ready) {
              return {
                ok: false,
                blockers: readiness.blockers,
                answers,
                message: `Still needed: ${readiness.blockers.join('; ')}. Ask for these, then call ad_launchpad again.`,
              };
            }
            return {
              ok: true,
              ready: true,
              answers,
              launch: readiness.input,
              progress,
              message:
                'The launchpad is complete. Call launch_meta_campaign with `launch` (it takes those fields as they are), ' +
                'then tell the owner what you created.' +
                (readiness.input?.instructions
                  ? ` Also honour this instruction from them, which the launchpad has no field for: "${readiness.input.instructions}".`
                  : ''),
            };
          }

          return {
            ok: true,
            ready: false,
            step: question.step,
            answers,
            progress,
            ...(acknowledged ? { acknowledged } : {}),
            // The chat renders this as a card with tap-able options and a free-text box.
            artifact: {
              type: 'user_input_prompt',
              question: question.question,
              context: [question.context, progress.label].filter(Boolean).join(' · '),
              suggestedOptions: question.options,
              allowFreeText: question.allowsFreeText,
              launchpad: { step: question.step, answers },
            },
            question: question.question,
            context: question.context,
            suggestedOptions: question.options,
            message:
              'Ask the owner this question and offer exactly these options (the chat renders them as buttons): ' +
              `${question.options.map((option) => `"${option}"`).join(', ') || 'no options — they type the answer'}. ` +
              'They may also type anything else; pass it back as justAnswered with lastStep ' +
              `"${question.step}". Do not ask the remaining questions in prose — this card is the form.`,
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'the launchpad could not continue' };
        }
      },
    }),
  };
}

/** Names this module registers, so a gate can assert they are actually wired. */
export const AD_LAUNCHPAD_TOOLS = ['ad_launchpad'] as const;
